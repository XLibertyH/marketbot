import { storage } from "./storage";
import { getAccount, getPositions } from "./alpaca";
import { addAutoTradeLog } from "./autoTrader";

interface KellyResult {
  kellyFraction: number;
  halfKellyFraction: number;
  positionSize: number;
  winRate: number;
  payoffRatio: number;
  equity: number;
}

interface TradeOutcome {
  symbol: string;
  signal: string;
  confidence: number;
  entryPrice: number;
  timestamp: string;
  outcome?: "win" | "loss";
  returnPct?: number;
}

const tradeHistory: TradeOutcome[] = [];
const MAX_HISTORY = 200;

export function recordTradeOutcome(outcome: TradeOutcome) {
  tradeHistory.unshift(outcome);
  if (tradeHistory.length > MAX_HISTORY) tradeHistory.length = MAX_HISTORY;
}

export function updateOutcomes(symbol: string, currentPrice: number, entryPrice: number) {
  for (const trade of tradeHistory) {
    if (trade.symbol === symbol && !trade.outcome) {
      const returnPct = (currentPrice - entryPrice) / entryPrice;
      trade.outcome = returnPct > 0 ? "win" : "loss";
      trade.returnPct = returnPct;
    }
  }
}

function getHistoricalStats(): { winRate: number; avgWin: number; avgLoss: number; sampleSize: number } {
  const resolved = tradeHistory.filter(t => t.outcome && t.returnPct !== undefined);

  if (resolved.length < 5) {
    return { winRate: 0, avgWin: 0, avgLoss: 0, sampleSize: resolved.length };
  }

  const wins = resolved.filter(t => t.outcome === "win");
  const losses = resolved.filter(t => t.outcome === "loss");

  const winRate = wins.length / resolved.length;
  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + Math.abs(t.returnPct!), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((sum, t) => sum + Math.abs(t.returnPct!), 0) / losses.length
    : 0;

  return { winRate, avgWin, avgLoss, sampleSize: resolved.length };
}

export async function calculateHalfKelly(
  signalConfidence: number,
  currentPrice: number
): Promise<KellyResult> {
  const settings = await storage.getSettings();

  let equity = 100000;
  try {
    const account = await getAccount();
    equity = parseFloat(account.equity);
  } catch {}

  const stats = getHistoricalStats();

  let winRate: number;
  let payoffRatio: number;

  if (stats.sampleSize >= 10 && stats.avgLoss > 0) {
    winRate = stats.winRate * 0.4 + signalConfidence * 0.6;
    payoffRatio = stats.avgWin / stats.avgLoss;
  } else {
    winRate = signalConfidence;
    payoffRatio = settings.takeProfitPercent / settings.stopLossPercent;
  }

  winRate = Math.max(0.1, Math.min(0.95, winRate));
  payoffRatio = Math.max(0.5, Math.min(10, payoffRatio));

  const lossRate = 1 - winRate;
  const kellyFraction = (payoffRatio * winRate - lossRate) / payoffRatio;

  const clampedKelly = Math.max(0, Math.min(0.25, kellyFraction));
  const halfKelly = clampedKelly * 0.5;

  const kellyPositionSize = equity * halfKelly;

  const minSize = Math.min(100, equity * 0.01);
  const maxSize = Math.min(settings.maxPositionSize, equity * 0.15);
  const positionSize = Math.max(minSize, Math.min(maxSize, kellyPositionSize));

  return {
    kellyFraction: clampedKelly,
    halfKellyFraction: halfKelly,
    positionSize: Math.round(positionSize * 100) / 100,
    winRate,
    payoffRatio,
    equity,
  };
}

export function getKellyStats(): {
  tradeCount: number;
  resolvedCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;
} {
  const stats = getHistoricalStats();
  return {
    tradeCount: tradeHistory.length,
    resolvedCount: tradeHistory.filter(t => t.outcome).length,
    winRate: stats.winRate,
    avgWin: stats.avgWin,
    avgLoss: stats.avgLoss,
    payoffRatio: stats.avgLoss > 0 ? stats.avgWin / stats.avgLoss : 0,
  };
}
