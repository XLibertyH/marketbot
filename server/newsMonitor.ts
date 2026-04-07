import { storage } from "./storage";
import { getFinnhubNews, getFinnhubMarketNews } from "./finnhub";
import { analyzeStock, discoverStocks, analyzeNewsSentiment } from "./aiAnalysis";
import { getFinnhubQuote, getFinnhubCandles } from "./finnhub";
import { placeOrder, getPositions } from "./alpaca";
import { validateOrder, recordOrderPlaced } from "./tradingGuards";
import { addAutoTradeLog } from "./autoTrader";
import { getMarketBuzz } from "./marketIntel";
import { isHistoricalDataAvailable, getHistoricalPrices, getStatisticalSummary } from "./historicalData";
import { log } from "./index";
import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

// Dedup with TTL — headlines expire after 10 minutes so fresh mock news keeps flowing
const HEADLINE_TTL_MS = 10 * 60 * 1000;
const seenHeadlines = new Map<string, number>(); // key -> timestamp
const seenMarketHeadlines = new Map<string, number>();
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let isMonitoring = false;
const NEWS_POLL_INTERVAL_MS = 30_000;

function pruneExpired(map: Map<string, number>) {
  const now = Date.now();
  const toDelete: string[] = [];
  map.forEach((ts, key) => {
    if (now - ts > HEADLINE_TTL_MS) toDelete.push(key);
  });
  toDelete.forEach(key => map.delete(key));
}

function headlineKey(symbol: string, headline: string): string {
  return `${symbol}:${headline.slice(0, 100)}`;
}

function marketHeadlineKey(headline: string): string {
  return `MARKET:${headline.slice(0, 100)}`;
}

async function checkNewsForSymbol(symbol: string): Promise<{ headline: string; source: string }[]> {
  try {
    pruneExpired(seenHeadlines);
    const articles = await getFinnhubNews(symbol, 20);
    const newArticles: { headline: string; source: string }[] = [];

    for (const article of articles) {
      const key = headlineKey(symbol, article.headline);
      if (!seenHeadlines.has(key)) {
        seenHeadlines.set(key, Date.now());
        newArticles.push({ headline: article.headline, source: article.source });
      }
    }

    return newArticles;
  } catch {
    return [];
  }
}

async function handleBreakingNews(symbol: string, newHeadlines: { headline: string; source: string }[]) {

  const headlineBatch = newHeadlines.slice(0, 8);

  // Score sentiment with AI
  let sentimentScores: number[] = [];
  try {
    const results = await analyzeNewsSentiment(
      headlineBatch.map(h => ({ headline: h.headline, symbol }))
    );
    sentimentScores = results.map(r => r.score);
  } catch {
    sentimentScores = headlineBatch.map(() => 0);
  }

  for (let i = 0; i < headlineBatch.length; i++) {
    const article = headlineBatch[i];
    const sentiment = sentimentScores[i] || 0;
    const sentimentLabel = sentiment > 0.3 ? "bullish" : sentiment < -0.3 ? "bearish" : "neutral";
    addAutoTradeLog("news", `Breaking: "${article.headline}" (${article.source}) [${sentimentLabel} ${sentiment.toFixed(2)}]`, symbol);

    await storage.addNews({
      symbol,
      headline: article.headline,
      summary: article.headline,
      source: article.source,
      sentiment,
      url: null,
    });
  }

  const avgSentiment = sentimentScores.length > 0
    ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length
    : 0;
  addAutoTradeLog("news", `${newHeadlines.length} new headline${newHeadlines.length > 1 ? "s" : ""} detected (avg sentiment: ${avgSentiment.toFixed(2)}) — triggering AI analysis`, symbol);

  let quote: StockQuote;
  let history: HistoricalDataPoint[];

  try {
    quote = await getFinnhubQuote(symbol);
    history = await getFinnhubCandles(symbol, 30);
  } catch {
    // Finnhub unavailable — try Alpaca position price
    try {
      const positions = await getPositions();
      const pos = positions.find(p => p.symbol === symbol);
      if (pos) {
        quote = { symbol, price: parseFloat(pos.current_price), change: parseFloat(pos.current_price) - parseFloat(pos.lastday_price), changePercent: +(parseFloat(pos.change_today) * 100).toFixed(2), high: parseFloat(pos.current_price), low: parseFloat(pos.current_price), open: parseFloat(pos.lastday_price), previousClose: parseFloat(pos.lastday_price), volume: 0 };
      } else {
        return; // No price data
      }
    } catch { return; }
    history = (isHistoricalDataAvailable() ? getHistoricalPrices(symbol, 30) : null) || [];
  }

  const allHeadlines = newHeadlines.map(h => h.headline);
  const stats = isHistoricalDataAvailable() ? getStatisticalSummary(symbol) : null;

  let signalData: { signal: string; confidence: number; reason: string };
  try {
    signalData = await analyzeStock(symbol, quote, history, allHeadlines, stats);
  } catch {
    return; // AI unavailable — don't store a mock signal
  }

  await storage.addSignal({
    symbol,
    signal: signalData.signal,
    confidence: signalData.confidence,
    price: quote.price,
    reason: signalData.reason,
  });

  addAutoTradeLog("signal", `News-driven ${signalData.signal} at ${(signalData.confidence * 100).toFixed(0)}% confidence — $${quote.price.toFixed(2)}`, symbol, {
    signal: signalData.signal,
    confidence: signalData.confidence,
    price: quote.price,
    triggeredBy: "news",
  });

  if (!settings.autoTrade) {
    addAutoTradeLog("skip", "Auto-trade disabled — signal logged but no order placed", symbol);
    return;
  }

  if (signalData.confidence < settings.autoTradeMinConfidence) {
    addAutoTradeLog("skip", `Confidence ${(signalData.confidence * 100).toFixed(0)}% below threshold ${(settings.autoTradeMinConfidence * 100).toFixed(0)}%`, symbol);
    return;
  }

  if (signalData.signal === "HOLD") {
    addAutoTradeLog("skip", "HOLD signal from news analysis — no action", symbol);
    return;
  }

  let existingPositions: string[] = [];
  try {
    const positions = await getPositions();
    existingPositions = positions.map(p => p.symbol.toUpperCase());
  } catch {
    addAutoTradeLog("error", "Could not fetch positions", symbol);
    return;
  }

  if (signalData.signal === "BUY") {
    if (existingPositions.includes(symbol.toUpperCase())) {
      addAutoTradeLog("skip", "Already holding position — skipping news-triggered BUY", symbol);
      return;
    }

    const qty = Math.max(1, Math.floor(settings.autoTradePositionSize / quote.price));
    const safety = await validateOrder({ symbol, qty, side: "buy", type: "market" });

    if (!safety.allowed) {
      addAutoTradeLog("skip", `Order blocked: ${safety.reason}`, symbol);
      return;
    }

    try {
      const order = await placeOrder({ symbol, qty, side: "buy", type: "market", time_in_force: "day" });
      recordOrderPlaced();
      addAutoTradeLog("trade", `NEWS-TRIGGERED BUY ${qty} shares at ~$${quote.price.toFixed(2)}`, symbol, {
        orderId: order.id, qty, side: "buy", triggeredBy: "news",
      });
    } catch (err: any) {
      addAutoTradeLog("error", `Failed news-triggered BUY: ${err.message}`, symbol);
    }
  }

  if (signalData.signal === "SELL") {
    if (!existingPositions.includes(symbol.toUpperCase())) {
      addAutoTradeLog("skip", "No position to sell — skipping news-triggered SELL", symbol);
      return;
    }

    try {
      const positions = await getPositions();
      const pos = positions.find(p => p.symbol.toUpperCase() === symbol.toUpperCase());
      if (!pos) return;

      const qty = parseInt(pos.qty);
      const safety = await validateOrder({ symbol, qty, side: "sell", type: "market" });

      if (!safety.allowed) {
        addAutoTradeLog("skip", `Sell blocked: ${safety.reason}`, symbol);
        return;
      }

      const order = await placeOrder({ symbol, qty, side: "sell", type: "market", time_in_force: "day" });
      recordOrderPlaced();
      addAutoTradeLog("trade", `NEWS-TRIGGERED SELL ${qty} shares at ~$${quote.price.toFixed(2)}`, symbol, {
        orderId: order.id, qty, side: "sell", triggeredBy: "news",
      });
    } catch (err: any) {
      addAutoTradeLog("error", `Failed news-triggered SELL: ${err.message}`, symbol);
    }
  }
}

async function checkMarketNews(): Promise<{ headline: string; source: string }[]> {
  try {
    pruneExpired(seenMarketHeadlines);
    const articles = await getFinnhubMarketNews(25);
    const newArticles: { headline: string; source: string }[] = [];

    for (const article of articles) {
      const key = marketHeadlineKey(article.headline);
      if (!seenMarketHeadlines.has(key)) {
        seenMarketHeadlines.set(key, Date.now());
        newArticles.push({ headline: article.headline, source: article.source });
      }
    }

    return newArticles;
  } catch {
    return [];
  }
}

async function handleMarketNews(newHeadlines: { headline: string; source: string }[]) {
  const marketBatch = newHeadlines.slice(0, 10);

  // Score market news sentiment with AI
  let marketSentiments: number[] = [];
  try {
    const results = await analyzeNewsSentiment(
      marketBatch.map(h => ({ headline: h.headline }))
    );
    marketSentiments = results.map(r => r.score);
  } catch {
    marketSentiments = marketBatch.map(() => 0);
  }

  for (let i = 0; i < marketBatch.length; i++) {
    const article = marketBatch[i];
    const sentiment = marketSentiments[i] || 0;
    const sentimentLabel = sentiment > 0.3 ? "bullish" : sentiment < -0.3 ? "bearish" : "neutral";
    addAutoTradeLog("news", `Market News: "${article.headline}" (${article.source}) [${sentimentLabel} ${sentiment.toFixed(2)}]`);

    await storage.addNews({
      symbol: "MARKET",
      headline: article.headline,
      summary: article.headline,
      source: article.source,
      sentiment,
      url: null,
    });
  }

  const avgMarketSentiment = marketSentiments.length > 0
    ? marketSentiments.reduce((a, b) => a + b, 0) / marketSentiments.length
    : 0;
  addAutoTradeLog("news", `${newHeadlines.length} new market headline${newHeadlines.length > 1 ? "s" : ""} detected (avg sentiment: ${avgMarketSentiment.toFixed(2)})`);

  const settings = await storage.getSettings();
  const watchlist = await storage.getWatchlist();
  const currentSymbols = watchlist.map(w => w.symbol.toUpperCase());
  const marketHeadlineTexts = newHeadlines.map(h => h.headline);

  // Augment with broad market buzz headlines so AI has social/SEC context
  const buzz = getMarketBuzz();
  if (buzz && buzz.topTickers.length > 0) {
    const buzzContext = buzz.topTickers
      .slice(0, 3)
      .flatMap(b => b.headlines.slice(0, 1));
    marketHeadlineTexts.push(...buzzContext);
  }

  try {
    const suggestions = await discoverStocks(currentSymbols, marketHeadlineTexts);
    for (const suggestion of suggestions) {
      if (!suggestion.symbol || suggestion.symbol.length === 0 || suggestion.symbol.length > 5) continue;
      if (currentSymbols.includes(suggestion.symbol)) continue;

      await storage.addWatchlistItem({ symbol: suggestion.symbol, name: suggestion.name });
      currentSymbols.push(suggestion.symbol);
      addAutoTradeLog("news", `Market news triggered: AI added ${suggestion.symbol} (${suggestion.name}) to watchlist — ${suggestion.reason}`, suggestion.symbol);
    }
  } catch (err: any) {
    log(`[NewsMonitor] Stock discovery from market news failed: ${err.message}`, "news-monitor");
  }

  if (settings.autoTrade && watchlist.length > 0) {
    for (const item of watchlist.slice(0, 3)) {
      try {
        let quote: StockQuote;
        let history: HistoricalDataPoint[];

        try {
          quote = await getFinnhubQuote(item.symbol);
          history = await getFinnhubCandles(item.symbol, 30);
        } catch {
          try {
            const positions = await getPositions();
            const pos = positions.find(p => p.symbol === item.symbol);
            if (pos) {
              quote = { symbol: item.symbol, price: parseFloat(pos.current_price), change: parseFloat(pos.current_price) - parseFloat(pos.lastday_price), changePercent: +(parseFloat(pos.change_today) * 100).toFixed(2), high: parseFloat(pos.current_price), low: parseFloat(pos.current_price), open: parseFloat(pos.lastday_price), previousClose: parseFloat(pos.lastday_price), volume: 0 };
            } else { continue; }
          } catch { continue; }
          history = (isHistoricalDataAvailable() ? getHistoricalPrices(item.symbol, 30) : null) || [];
        }

        const itemStats = isHistoricalDataAvailable() ? getStatisticalSummary(item.symbol) : null;

        let signalData: { signal: string; confidence: number; reason: string };
        try {
          signalData = await analyzeStock(item.symbol, quote, history, marketHeadlineTexts, itemStats);
        } catch {
          continue; // AI unavailable — skip, don't store a mock signal
        }

        await storage.addSignal({
          symbol: item.symbol,
          signal: signalData.signal,
          confidence: signalData.confidence,
          price: quote.price,
          reason: signalData.reason,
        });

        addAutoTradeLog("signal", `Market-news-driven ${signalData.signal} at ${(signalData.confidence * 100).toFixed(0)}% confidence — $${quote.price.toFixed(2)}`, item.symbol, {
          signal: signalData.signal, confidence: signalData.confidence, price: quote.price, triggeredBy: "market-news",
        });

        if (signalData.confidence < settings.autoTradeMinConfidence || signalData.signal === "HOLD") continue;

        let existingPositions: string[] = [];
        try {
          const positions = await getPositions();
          existingPositions = positions.map(p => p.symbol.toUpperCase());
        } catch { continue; }

        if (signalData.signal === "BUY" && !existingPositions.includes(item.symbol.toUpperCase())) {
          const qty = Math.max(1, Math.floor(settings.autoTradePositionSize / quote.price));
          const safety = await validateOrder({ symbol: item.symbol, qty, side: "buy", type: "market" });
          if (!safety.allowed) continue;

          try {
            const order = await placeOrder({ symbol: item.symbol, qty, side: "buy", type: "market", time_in_force: "day" });
            recordOrderPlaced();
            addAutoTradeLog("trade", `MARKET-NEWS BUY ${qty} shares at ~$${quote.price.toFixed(2)}`, item.symbol, {
              orderId: order.id, qty, side: "buy", triggeredBy: "market-news",
            });
          } catch (err: any) {
            addAutoTradeLog("error", `Failed market-news BUY: ${err.message}`, item.symbol);
          }
        }

        if (signalData.signal === "SELL" && existingPositions.includes(item.symbol.toUpperCase())) {
          try {
            const positions = await getPositions();
            const pos = positions.find(p => p.symbol.toUpperCase() === item.symbol.toUpperCase());
            if (!pos) continue;
            const qty = parseInt(pos.qty);
            const safety = await validateOrder({ symbol: item.symbol, qty, side: "sell", type: "market" });
            if (!safety.allowed) continue;
            const order = await placeOrder({ symbol: item.symbol, qty, side: "sell", type: "market", time_in_force: "day" });
            recordOrderPlaced();
            addAutoTradeLog("trade", `MARKET-NEWS SELL ${qty} shares at ~$${quote.price.toFixed(2)}`, item.symbol, {
              orderId: order.id, qty, side: "sell", triggeredBy: "market-news",
            });
          } catch (err: any) {
            addAutoTradeLog("error", `Failed market-news SELL: ${err.message}`, item.symbol);
          }
        }
      } catch (err: any) {
        addAutoTradeLog("error", `Market news analysis failed for ${item.symbol}: ${err.message}`, item.symbol);
      }
    }
  }
}

async function pollAllNews() {
  // ── Finnhub market news (requires API key, silently skipped if unavailable) ──
  try {
    const newMarketHeadlines = await checkMarketNews();
    if (newMarketHeadlines.length > 0) {
      await handleMarketNews(newMarketHeadlines);
    }
  } catch (err: any) {
    log(`[NewsMonitor] Finnhub market news unavailable: ${err.message}`, "news-monitor");
  }

  const watchlist = await storage.getWatchlist();
  if (watchlist.length === 0) return;

  // ── Finnhub per-symbol news (requires API key, silently skipped if unavailable) ──
  for (const item of watchlist) {
    try {
      const newHeadlines = await checkNewsForSymbol(item.symbol);
      if (newHeadlines.length > 0) {
        await handleBreakingNews(item.symbol, newHeadlines);
      }
    } catch (err: any) {
      log(`[NewsMonitor] Finnhub news for ${item.symbol} unavailable: ${err.message}`, "news-monitor");
    }
  }
}

export async function startNewsMonitor() {
  if (isMonitoring) return;
  isMonitoring = true;

  addAutoTradeLog("start", "News monitor started — checking headlines every 30 seconds");

  // Pre-index existing Finnhub headlines so we only alert on NEW ones (silently skipped if no key)
  try {
    const marketArticles = await getFinnhubMarketNews(25);
    for (const article of marketArticles) {
      seenMarketHeadlines.set(marketHeadlineKey(article.headline), Date.now());
    }
    addAutoTradeLog("scan", `Indexed ${marketArticles.length} existing Finnhub market headlines`);
  } catch {}

  const watchlist = await storage.getWatchlist();
  for (const item of watchlist) {
    try {
      const articles = await getFinnhubNews(item.symbol, 20);
      for (const article of articles) {
        seenHeadlines.set(headlineKey(item.symbol, article.headline), Date.now());
      }
    } catch {}
  }
  addAutoTradeLog("scan", `Indexed existing headlines for ${watchlist.length} stocks — monitoring for new ones`);

  monitorInterval = setInterval(() => {
    pollAllNews().catch(err => log(`[NewsMonitor] Poll failed: ${err.message}`, "news-monitor"));
  }, NEWS_POLL_INTERVAL_MS);
}

export function stopNewsMonitor() {
  if (!isMonitoring) return;

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  isMonitoring = false;
  addAutoTradeLog("stop", "News monitor stopped");
}

export function isNewsMonitorRunning(): boolean {
  return isMonitoring;
}

export async function restartNewsMonitor() {
  stopNewsMonitor();
  // Clear dedup caches so fresh news flows immediately
  seenHeadlines.clear();
  seenMarketHeadlines.clear();
  await startNewsMonitor();
}
