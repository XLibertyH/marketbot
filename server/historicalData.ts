import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { HistoricalDataPoint, StatisticalSummary } from "@shared/schema";

// Support both ESM (import.meta.url) and CJS (__dirname) for production builds
const _dir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(_dir, "data", "prices.sqlite");

let db: Database.Database | null = null;
let tickerList: string[] = [];
let stmtHistory: Database.Statement | null = null;
let stmtFullHistory: Database.Statement | null = null;
let stmtLatestPrice: Database.Statement | null = null;

// In-memory cache for statistical summaries (invalidated daily)
const statsCache = new Map<string, { summary: StatisticalSummary; computedDate: string }>();

export function initHistoricalDB(): void {
  if (!existsSync(DB_PATH)) {
    console.log("[HistoricalDB] No prices.sqlite found — using mock/Finnhub data as fallback");
    return;
  }

  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -500000"); // 500MB cache

    // Prepare statements
    stmtHistory = db.prepare(
      "SELECT date, open, high, low, close, volume FROM prices WHERE ticker = ? AND date >= ? ORDER BY date ASC"
    );
    stmtFullHistory = db.prepare(
      "SELECT date, open, high, low, close, volume FROM prices WHERE ticker = ? ORDER BY date ASC"
    );
    stmtLatestPrice = db.prepare(
      "SELECT date, close, volume FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1"
    );

    // Load ticker universe
    const rows = db.prepare("SELECT ticker FROM tickers ORDER BY ticker").all() as { ticker: string }[];
    tickerList = rows.map(r => r.ticker);

    console.log(`[HistoricalDB] Loaded: ${tickerList.length.toLocaleString()} tickers, DB at ${DB_PATH}`);
  } catch (err: any) {
    console.error("[HistoricalDB] Failed to open database:", err.message);
    db = null;
  }
}

export function isHistoricalDataAvailable(): boolean {
  return db !== null;
}

export function getTickerUniverse(): string[] {
  return tickerList;
}

export function getHistoricalPrices(ticker: string, days: number): HistoricalDataPoint[] | null {
  if (!db || !stmtHistory) return null;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const dateStr = cutoffDate.toISOString().split("T")[0];

  try {
    const rows = stmtHistory.all(ticker.toUpperCase(), dateStr) as any[];
    if (rows.length === 0) return null;

    return rows.map(r => ({
      date: r.date,
      open: +r.open.toFixed(2),
      high: +r.high.toFixed(2),
      low: +r.low.toFixed(2),
      close: +r.close.toFixed(2),
      volume: r.volume,
    }));
  } catch {
    return null;
  }
}

export function getLatestPrice(ticker: string): { date: string; close: number; volume: number } | null {
  if (!db || !stmtLatestPrice) return null;

  try {
    const row = stmtLatestPrice.get(ticker.toUpperCase()) as any;
    if (!row) return null;
    return { date: row.date, close: row.close, volume: row.volume };
  } catch {
    return null;
  }
}

export function getStatisticalSummary(ticker: string): StatisticalSummary | null {
  if (!db || !stmtFullHistory) return null;

  const today = new Date().toISOString().split("T")[0];
  const cached = statsCache.get(ticker);
  if (cached && cached.computedDate === today) return cached.summary;

  try {
    const rows = stmtFullHistory.all(ticker.toUpperCase()) as any[];
    if (rows.length < 20) return null;

    const closes = rows.map((r: any) => r.close);
    const highs = rows.map((r: any) => r.high);
    const lows = rows.map((r: any) => r.low);
    const volumes = rows.map((r: any) => r.volume);
    const dates = rows.map((r: any) => r.date);
    const n = closes.length;

    // 52-week range (last ~252 trading days)
    const last252 = closes.slice(-252);
    const highs252 = highs.slice(-252);
    const lows252 = lows.slice(-252);
    const high52w = Math.max(...highs252);
    const low52w = Math.min(...lows252);

    // Average volumes
    const avgVolume20d = avg(volumes.slice(-20));
    const avgVolume90d = avg(volumes.slice(-90));

    // Annualized volatility (daily log returns)
    const volatility20d = computeVolatility(closes.slice(-21)) * Math.sqrt(252);
    const volatility90d = computeVolatility(closes.slice(-91)) * Math.sqrt(252);

    // Returns
    const currentPrice = closes[n - 1];
    const ytdStart = findClosestPrice(closes, dates, `${new Date().getFullYear()}-01-01`);
    const ytdReturn = ytdStart ? ((currentPrice - ytdStart) / ytdStart) * 100 : 0;
    const return1y = computeReturn(closes, 252);
    const return3y = computeReturn(closes, 756);
    const return5y = computeReturn(closes, 1260);

    // Moving averages
    const sma50 = avg(closes.slice(-50));
    const sma200 = avg(closes.slice(-200));

    // RSI(14)
    const rsi14 = computeRSI(closes.slice(-15));

    // ATR(14)
    const atr14 = computeATR(highs.slice(-15), lows.slice(-15), closes.slice(-15));

    const summary: StatisticalSummary = {
      ticker: ticker.toUpperCase(),
      high52w: +high52w.toFixed(2),
      low52w: +low52w.toFixed(2),
      avgVolume20d: Math.round(avgVolume20d),
      avgVolume90d: Math.round(avgVolume90d),
      volatility20d: +(volatility20d * 100).toFixed(1),
      volatility90d: +(volatility90d * 100).toFixed(1),
      ytdReturn: +ytdReturn.toFixed(2),
      return1y: +return1y.toFixed(2),
      return3y: +return3y.toFixed(2),
      return5y: +return5y.toFixed(2),
      sma50: +sma50.toFixed(2),
      sma200: +sma200.toFixed(2),
      rsi14: +rsi14.toFixed(1),
      atr14: +atr14.toFixed(2),
    };

    statsCache.set(ticker, { summary, computedDate: today });
    return summary;
  } catch {
    return null;
  }
}

// --- Utility functions ---

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function computeVolatility(closes: number[]): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (returns.length === 0) return 0;
  const mean = avg(returns);
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function computeReturn(closes: number[], lookbackDays: number): number {
  if (closes.length < lookbackDays + 1) return 0;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - lookbackDays];
  return past > 0 ? ((current - past) / past) * 100 : 0;
}

function findClosestPrice(closes: number[], dates: string[], targetDate: string): number | null {
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= targetDate) return closes[i];
  }
  return null;
}

function computeRSI(closes: number[]): number {
  if (closes.length < 2) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const periods = closes.length - 1;
  const avgGain = gains / periods;
  const avgLoss = losses / periods;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeATR(highs: number[], lows: number[], closes: number[]): number {
  if (highs.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  return avg(trs);
}
