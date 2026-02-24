import { storage } from "./storage";
import { getFinnhubNews } from "./finnhub";
import { analyzeStock } from "./aiAnalysis";
import { getFinnhubQuote, getFinnhubCandles } from "./finnhub";
import { getMockQuote, getMockHistoricalData, getMockSignal } from "./mockData";
import { placeOrder, getPositions } from "./alpaca";
import { validateOrder, recordOrderPlaced } from "./tradingGuards";
import { addAutoTradeLog } from "./autoTrader";
import { log } from "./index";
import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

const seenHeadlines = new Set<string>();
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let isMonitoring = false;
const NEWS_POLL_INTERVAL_MS = 60_000;

function headlineKey(symbol: string, headline: string): string {
  return `${symbol}:${headline.slice(0, 100)}`;
}

async function checkNewsForSymbol(symbol: string): Promise<{ headline: string; source: string }[]> {
  try {
    const articles = await getFinnhubNews(symbol, 10);
    const newArticles: { headline: string; source: string }[] = [];

    for (const article of articles) {
      const key = headlineKey(symbol, article.headline);
      if (!seenHeadlines.has(key)) {
        seenHeadlines.add(key);
        newArticles.push({ headline: article.headline, source: article.source });
      }
    }

    return newArticles;
  } catch {
    return [];
  }
}

async function handleBreakingNews(symbol: string, newHeadlines: { headline: string; source: string }[]) {
  const settings = await storage.getSettings();

  for (const article of newHeadlines.slice(0, 3)) {
    addAutoTradeLog("news", `Breaking: "${article.headline}" (${article.source})`, symbol);

    await storage.addNews({
      symbol,
      headline: article.headline,
      summary: article.headline,
      source: article.source,
      sentiment: 0,
      url: null,
    });
  }

  addAutoTradeLog("news", `${newHeadlines.length} new headline${newHeadlines.length > 1 ? "s" : ""} detected — triggering AI analysis`, symbol);

  let quote: StockQuote;
  let history: HistoricalDataPoint[];

  try {
    quote = await getFinnhubQuote(symbol);
    history = await getFinnhubCandles(symbol, 30);
  } catch {
    quote = getMockQuote(symbol);
    history = getMockHistoricalData(symbol, 30);
  }

  const allHeadlines = newHeadlines.map(h => h.headline);

  let signalData: { signal: string; confidence: number; reason: string };
  try {
    signalData = await analyzeStock(symbol, quote, history, allHeadlines);
  } catch {
    signalData = getMockSignal(symbol, quote.price);
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

async function pollAllNews() {
  const settings = await storage.getSettings();

  if (settings.simulationMode) return;

  const watchlist = await storage.getWatchlist();
  if (watchlist.length === 0) return;

  for (const item of watchlist) {
    try {
      const newHeadlines = await checkNewsForSymbol(item.symbol);
      if (newHeadlines.length > 0) {
        await handleBreakingNews(item.symbol, newHeadlines);
      }
    } catch (err: any) {
      log(`[NewsMonitor] Error checking ${item.symbol}: ${err.message}`, "news-monitor");
    }
  }
}

export async function startNewsMonitor() {
  if (isMonitoring) return;
  isMonitoring = true;

  addAutoTradeLog("start", "News monitor started — checking for breaking headlines every 60 seconds");

  const settings = await storage.getSettings();
  if (!settings.simulationMode) {
    const watchlist = await storage.getWatchlist();
    for (const item of watchlist) {
      try {
        const articles = await getFinnhubNews(item.symbol, 10);
        for (const article of articles) {
          seenHeadlines.add(headlineKey(item.symbol, article.headline));
        }
      } catch {}
    }
    addAutoTradeLog("scan", `Indexed existing headlines for ${watchlist.length} stocks — monitoring for new ones`);
  }

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
  const settings = await storage.getSettings();
  if (!settings.simulationMode) {
    await startNewsMonitor();
  }
}
