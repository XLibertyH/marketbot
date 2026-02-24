import { storage } from "./storage";
import { analyzeStock, discoverStocks } from "./aiAnalysis";
import { placeOrder, getAccount, getPositions, isLiveTrading } from "./alpaca";
import { validateOrder, recordOrderPlaced } from "./tradingGuards";
import { getMockQuote, getMockHistoricalData, getMockNews, getMockSignal } from "./mockData";
import { getFinnhubQuote, getFinnhubCandles, getFinnhubNews } from "./finnhub";
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
        if (!settings.simulationMode) {
          quote = await getFinnhubQuote(item.symbol);
          history = await getFinnhubCandles(item.symbol, 30);
          const liveNews = await getFinnhubNews(item.symbol, 3);
          headlines = liveNews.map(n => n.headline);
        } else {
          quote = getMockQuote(item.symbol);
          history = getMockHistoricalData(item.symbol, 30);
          headlines = getMockNews(item.symbol, 3).map(n => n.headline);
        }
      } catch {
        quote = getMockQuote(item.symbol);
        history = getMockHistoricalData(item.symbol, 30);
        headlines = getMockNews(item.symbol, 3).map(n => n.headline);
      }

      let signalData: { signal: string; confidence: number; reason: string };
      try {
        signalData = await analyzeStock(item.symbol, quote, history, headlines);
      } catch {
        signalData = getMockSignal(item.symbol, quote.price);
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
        if (existingPositions.includes(item.symbol.toUpperCase())) {
          addLog("skip", "Already holding a position — skipping BUY", item.symbol);
          continue;
        }

        const qty = Math.max(1, Math.floor(settings.autoTradePositionSize / quote.price));
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
          addLog("trade", `BUY ${qty} shares at ~$${quote.price.toFixed(2)} (est. $${estimatedValue.toFixed(2)})`, item.symbol, {
            orderId: order.id,
            qty,
            side: "buy",
            estimatedValue,
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
}

async function discoverNewStocks(settings: Awaited<ReturnType<typeof storage.getSettings>>) {
  try {
    const watchlist = await storage.getWatchlist();
    const currentSymbols = watchlist.map(w => w.symbol.toUpperCase());

    let recentNews: string[] = [];
    if (!settings.simulationMode) {
      for (const item of watchlist.slice(0, 3)) {
        try {
          const news = await getFinnhubNews(item.symbol, 3);
          recentNews.push(...news.map(n => n.headline));
        } catch {}
      }
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

  addLog("start", `Auto-trader started — scanning every ${settings.autoTradeInterval} minutes, min confidence ${(settings.autoTradeMinConfidence * 100).toFixed(0)}%, position size $${settings.autoTradePositionSize}`);

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
