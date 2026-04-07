import { storage } from "./storage";
import { analyzeStock, discoverStocks, detectMarketRegime, analyzeNewsSentiment } from "./aiAnalysis";
import type { MarketRegime } from "./aiAnalysis";
import { placeOrder, getAccount, getPositions, isLiveTrading } from "./alpaca";
import { validateOrder, recordOrderPlaced } from "./tradingGuards";
import { getFinnhubQuote, getFinnhubCandles, getFinnhubNews } from "./finnhub";
import { calculateHalfKelly, recordTradeOutcome, updateOutcomes } from "./kellyCriterion";
import { runMomentumScan } from "./momentumScanner";
import { getMarketBuzz } from "./marketIntel";
import { isHistoricalDataAvailable, getHistoricalPrices, getStatisticalSummary } from "./historicalData";
import { log } from "./index";
import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

export interface AutoTradeLogEntry {
  id: number;
  timestamp: string;
  type: "scan" | "signal" | "trade" | "skip" | "error" | "start" | "stop" | "news";
  symbol?: string;
  message: string;
  details?: Record<string, any>;
}

const activityLog: AutoTradeLogEntry[] = [];
let nextLogId = 1;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRunTime: string | null = null;

export function addAutoTradeLog(type: AutoTradeLogEntry["type"], message: string, symbol?: string, details?: Record<string, any>) {
  addLog(type, message, symbol, details);
}

function addLog(type: AutoTradeLogEntry["type"], message: string, symbol?: string, details?: Record<string, any>) {
  const entry: AutoTradeLogEntry = {
    id: nextLogId++,
    timestamp: new Date().toISOString(),
    type,
    symbol,
    message,
    details,
  };
  activityLog.unshift(entry);
  if (activityLog.length > 100) activityLog.length = 100;
  log(`[AutoTrader] ${symbol ? `[${symbol}] ` : ""}${message}`, "auto-trader");
}

export function getAutoTradeLog(limit = 50): AutoTradeLogEntry[] {
  return activityLog.slice(0, limit);
}

export function getAutoTradeStatus(): { running: boolean; lastRun: string | null; logCount: number } {
  return { running: isRunning, lastRun: lastRunTime, logCount: activityLog.length };
}

async function runAutoTradePass() {
  const settings = await storage.getSettings();

  if (!settings.autoTrade) {
    stopAutoTrader();
    return;
  }

  lastRunTime = new Date().toISOString();
  const watchlist = await storage.getWatchlist();

  if (watchlist.length === 0) {
    addLog("scan", "No stocks in watchlist to analyze");
    return;
  }

  addLog("scan", `Scanning ${watchlist.length} stocks from watchlist`);

  // Detect market regime using SPY or broad market proxy
  let regime: MarketRegime | null = null;
  try {
    const spyHistory = (isHistoricalDataAvailable() ? getHistoricalPrices("SPY", 60) : null) || [];
    regime = await detectMarketRegime(spyHistory);
    addLog("signal", `Market regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}% confidence, exposure: ${(regime.suggestedExposure * 100).toFixed(0)}%) — ${regime.reason}`);

    if (regime.regime === "crisis") {
      addLog("skip", "CRISIS regime detected — skipping all BUY orders this cycle");
    }
  } catch (err: any) {
    addLog("error", `Market regime detection failed: ${err.message}`);
  }

  let existingPositions: string[] = [];
  try {
    const positions = await getPositions();
    existingPositions = positions.map(p => p.symbol.toUpperCase());
  } catch {
    addLog("error", "Could not fetch current positions");
  }

  for (const item of watchlist) {
    try {
      let quote: StockQuote;
      let history: HistoricalDataPoint[];
      let headlines: string[];

      try {
        quote = await getFinnhubQuote(item.symbol);
        history = await getFinnhubCandles(item.symbol, 30);
        const liveNews = await getFinnhubNews(item.symbol, 3);
        headlines = liveNews.map(n => n.headline);
      } catch {
        // Finnhub unavailable — try Alpaca position for price
        try {
          const positions = await getPositions();
          const pos = positions.find(p => p.symbol === item.symbol);
          if (pos) {
            quote = { symbol: item.symbol, price: parseFloat(pos.current_price), change: parseFloat(pos.current_price) - parseFloat(pos.lastday_price), changePercent: +(parseFloat(pos.change_today) * 100).toFixed(2), high: parseFloat(pos.current_price), low: parseFloat(pos.current_price), open: parseFloat(pos.lastday_price), previousClose: parseFloat(pos.lastday_price), volume: 0 };
          } else {
            continue; // No data for this symbol
          }
        } catch { continue; }
        history = (isHistoricalDataAvailable() ? getHistoricalPrices(item.symbol, 30) : null) || [];
        headlines = [];
      }

      // Get statistical summary from 30-year historical DB
      const stats = isHistoricalDataAvailable() ? getStatisticalSummary(item.symbol) : null;

      let signalData: { signal: string; confidence: number; reason: string };
      try {
        signalData = await analyzeStock(item.symbol, quote, history, headlines, stats);
      } catch {
        continue; // AI unavailable — skip this symbol, don't store a mock signal
      }

      // Adjust confidence based on news sentiment
      if (headlines.length > 0) {
        try {
          const sentimentResults = await analyzeNewsSentiment(
            headlines.map(h => ({ headline: h, symbol: item.symbol }))
          );
          const avgSentiment = sentimentResults.reduce((sum, r) => sum + r.score, 0) / sentimentResults.length;

          if (avgSentiment < -0.6) {
            const before = signalData.confidence;
            signalData.confidence = Math.max(0, signalData.confidence - 0.10);
            addLog("signal", `Bearish sentiment (${avgSentiment.toFixed(2)}) — confidence reduced ${(before * 100).toFixed(0)}% → ${(signalData.confidence * 100).toFixed(0)}%`, item.symbol);
          } else if (avgSentiment > 0.6) {
            const before = signalData.confidence;
            signalData.confidence = Math.min(1, signalData.confidence + 0.05);
            addLog("signal", `Bullish sentiment (${avgSentiment.toFixed(2)}) — confidence boosted ${(before * 100).toFixed(0)}% → ${(signalData.confidence * 100).toFixed(0)}%`, item.symbol);
          }
        } catch {
          // Sentiment analysis failed, continue without adjustment
        }
      }

      await storage.addSignal({
        symbol: item.symbol,
        signal: signalData.signal,
        confidence: signalData.confidence,
        price: quote.price,
        reason: signalData.reason,
      });

      addLog("signal", `${signalData.signal} signal at ${(signalData.confidence * 100).toFixed(0)}% confidence — $${quote.price.toFixed(2)}`, item.symbol, {
        signal: signalData.signal,
        confidence: signalData.confidence,
        price: quote.price,
      });

      if (signalData.confidence < settings.autoTradeMinConfidence) {
        addLog("skip", `Confidence ${(signalData.confidence * 100).toFixed(0)}% below threshold ${(settings.autoTradeMinConfidence * 100).toFixed(0)}%`, item.symbol);
        continue;
      }

      if (signalData.signal === "HOLD") {
        addLog("skip", "HOLD signal — no action taken", item.symbol);
        continue;
      }

      if (signalData.signal === "BUY") {
        // Skip BUYs during crisis regime
        if (regime?.regime === "crisis") {
          addLog("skip", "BUY skipped — market in CRISIS regime", item.symbol);
          continue;
        }

        if (existingPositions.includes(item.symbol.toUpperCase())) {
          addLog("skip", "Already holding a position — skipping BUY", item.symbol);
          continue;
        }

        let positionDollars = settings.autoTradePositionSize;
        let sizingMethod = "fixed";

        if (settings.riskLevel === "medium-controlled") {
          try {
            const kelly = await calculateHalfKelly(signalData.confidence, quote.price);
            positionDollars = kelly.positionSize;
            sizingMethod = "half-kelly";
            addLog("signal", `Half-Kelly sizing: ${(kelly.halfKellyFraction * 100).toFixed(1)}% of $${kelly.equity.toFixed(0)} = $${positionDollars.toFixed(0)} (win rate: ${(kelly.winRate * 100).toFixed(0)}%, payoff: ${kelly.payoffRatio.toFixed(2)}x)`, item.symbol, {
              kellyFraction: kelly.kellyFraction,
              halfKellyFraction: kelly.halfKellyFraction,
              positionSize: kelly.positionSize,
              winRate: kelly.winRate,
              payoffRatio: kelly.payoffRatio,
            });
          } catch (err: any) {
            addLog("error", `Kelly calculation failed, using fixed size: ${err.message}`, item.symbol);
          }
        }

        // Apply regime exposure multiplier
        if (regime && regime.suggestedExposure < 1.0) {
          const before = positionDollars;
          positionDollars = positionDollars * regime.suggestedExposure;
          addLog("signal", `Regime adjustment: $${before.toFixed(0)} × ${(regime.suggestedExposure * 100).toFixed(0)}% exposure = $${positionDollars.toFixed(0)}`, item.symbol);
        }

        const qty = Math.max(1, Math.floor(positionDollars / quote.price));
        const estimatedValue = qty * quote.price;

        const safety = await validateOrder({
          symbol: item.symbol,
          qty,
          side: "buy",
          type: "market",
        });

        if (!safety.allowed) {
          addLog("skip", `Order blocked by safety guard: ${safety.reason}`, item.symbol);
          continue;
        }

        try {
          const order = await placeOrder({
            symbol: item.symbol,
            qty,
            side: "buy",
            type: "market",
            time_in_force: "day",
          });
          recordOrderPlaced();
          existingPositions.push(item.symbol.toUpperCase());

          recordTradeOutcome({
            symbol: item.symbol,
            signal: signalData.signal,
            confidence: signalData.confidence,
            entryPrice: quote.price,
            timestamp: new Date().toISOString(),
          });

          addLog("trade", `BUY ${qty} shares at ~$${quote.price.toFixed(2)} (est. $${estimatedValue.toFixed(2)}, sizing: ${sizingMethod})`, item.symbol, {
            orderId: order.id,
            qty,
            side: "buy",
            estimatedValue,
            sizingMethod,
          });
        } catch (err: any) {
          addLog("error", `Failed to place BUY order: ${err.message}`, item.symbol);
        }
      }

      if (signalData.signal === "SELL") {
        if (!existingPositions.includes(item.symbol.toUpperCase())) {
          addLog("skip", "No position to sell — skipping SELL", item.symbol);
          continue;
        }

        try {
          const positions = await getPositions();
          const pos = positions.find(p => p.symbol.toUpperCase() === item.symbol.toUpperCase());
          if (!pos) {
            addLog("skip", "Position not found for SELL", item.symbol);
            continue;
          }

          const qty = parseInt(pos.qty);
          const safety = await validateOrder({
            symbol: item.symbol,
            qty,
            side: "sell",
            type: "market",
          });

          if (!safety.allowed) {
            addLog("skip", `Sell blocked by safety guard: ${safety.reason}`, item.symbol);
            continue;
          }

          const order = await placeOrder({
            symbol: item.symbol,
            qty,
            side: "sell",
            type: "market",
            time_in_force: "day",
          });
          recordOrderPlaced();
          existingPositions = existingPositions.filter(s => s !== item.symbol.toUpperCase());
          addLog("trade", `SELL ${qty} shares at ~$${quote.price.toFixed(2)}`, item.symbol, {
            orderId: order.id,
            qty,
            side: "sell",
          });
        } catch (err: any) {
          addLog("error", `Failed to place SELL order: ${err.message}`, item.symbol);
        }
      }
    } catch (err: any) {
      addLog("error", `Analysis failed: ${err.message}`, item.symbol);
    }
  }

  addLog("scan", "Auto-trade scan complete");

  await discoverNewStocks(settings);

  // Momentum scanner — rotate through broader ticker universe looking for big movers
  try {
    await runMomentumScan();
  } catch (err: any) {
    addLog("error", `Momentum scan failed: ${err.message}`);
  }
}

async function discoverNewStocks(settings: Awaited<ReturnType<typeof storage.getSettings>>) {
  try {
    const watchlist = await storage.getWatchlist();
    const currentSymbols = watchlist.map(w => w.symbol.toUpperCase());

    let recentNews: string[] = [];
    for (const item of watchlist.slice(0, 3)) {
      try {
        const news = await getFinnhubNews(item.symbol, 3);
        recentNews.push(...news.map(n => n.headline));
      } catch {}
    }

    // Enrich with broad market buzz from Reddit/RSS/SEC
    const buzz = getMarketBuzz();
    if (buzz && buzz.topTickers.length > 0) {
      const buzzHeadlines = buzz.topTickers
        .slice(0, 5)
        .flatMap(b => b.headlines.slice(0, 2))
        .filter(h => h.length > 0);
      const buzzSummary = buzz.topTickers
        .slice(0, 4)
        .map(b => `${b.ticker} trending (${b.mentionCount} mentions across ${b.sources.join("/")})`)
      recentNews.push(...buzzHeadlines, ...buzzSummary);
      addLog("scan", `Injecting ${buzzHeadlines.length} buzz headlines from ${buzz.topTickers.length} trending tickers into AI discovery`);
    }

    addLog("scan", "AI scanning for new stocks to add to watchlist...");

    const suggestions = await discoverStocks(currentSymbols, recentNews);

    if (suggestions.length === 0) {
      addLog("skip", "AI found no new stocks to suggest this cycle");
      return;
    }

    for (const suggestion of suggestions) {
      if (!suggestion.symbol || suggestion.symbol.length === 0 || suggestion.symbol.length > 5) continue;

      const alreadyExists = currentSymbols.includes(suggestion.symbol);
      if (alreadyExists) {
        addLog("skip", `${suggestion.symbol} already on watchlist`, suggestion.symbol);
        continue;
      }

      await storage.addWatchlistItem({ symbol: suggestion.symbol, name: suggestion.name });
      currentSymbols.push(suggestion.symbol);
      addLog("news", `AI added ${suggestion.symbol} (${suggestion.name}) to watchlist: ${suggestion.reason}`, suggestion.symbol, {
        action: "watchlist_add",
        reason: suggestion.reason,
      });
    }
  } catch (err: any) {
    addLog("error", `Stock discovery failed: ${err.message}`);
  }
}

export async function startAutoTrader() {
  if (isRunning) return;

  const settings = await storage.getSettings();
  if (!settings.autoTrade) return;

  isRunning = true;
  const intervalMs = Math.max(1, settings.autoTradeInterval) * 60 * 1000;

  const sizingLabel = settings.riskLevel === "medium-controlled"
    ? "half-Kelly dynamic sizing"
    : `fixed $${settings.autoTradePositionSize}`;
  addLog("start", `Auto-trader started — scanning every ${settings.autoTradeInterval} minutes, min confidence ${(settings.autoTradeMinConfidence * 100).toFixed(0)}%, sizing: ${sizingLabel}`);

  runAutoTradePass().catch(err => addLog("error", `Auto-trade pass failed: ${err.message}`));

  intervalHandle = setInterval(() => {
    runAutoTradePass().catch(err => addLog("error", `Auto-trade pass failed: ${err.message}`));
  }, intervalMs);
}

export function stopAutoTrader() {
  if (!isRunning) return;

  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  isRunning = false;
  addLog("stop", "Auto-trader stopped");
}

export async function restartAutoTrader() {
  stopAutoTrader();
  const settings = await storage.getSettings();
  if (settings.autoTrade) {
    await startAutoTrader();
  }
}
