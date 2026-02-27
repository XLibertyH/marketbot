import { storage } from "./storage";
import { getAccount, getOrders, getPositions, isLiveTrading } from "./alpaca";

const dailyOrderCounts = new Map<string, number>();
const dailyLossTracking = new Map<string, number>();

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getDailyOrderCount(): number {
  return dailyOrderCounts.get(getTodayKey()) || 0;
}

function incrementDailyOrderCount(): void {
  const key = getTodayKey();
  dailyOrderCounts.set(key, (dailyOrderCounts.get(key) || 0) + 1);
}

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  warnings: string[];
  isLive: boolean;
}

export async function validateOrder(params: {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type: string;
  limit_price?: number;
}): Promise<SafetyCheckResult> {
  const settings = await storage.getSettings();
  const warnings: string[] = [];
  const live = isLiveTrading();


  if (params.qty <= 0 || !Number.isFinite(params.qty)) {
    return { allowed: false, reason: "Invalid quantity", warnings, isLive: live };
  }

  if (params.qty > 10000) {
    return { allowed: false, reason: "Quantity exceeds maximum of 10,000 shares per order", warnings, isLive: live };
  }

  if (settings.allowedSymbols) {
    const allowed = settings.allowedSymbols.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(params.symbol.toUpperCase())) {
      return { allowed: false, reason: `Symbol ${params.symbol} is not in allowed symbols list: ${settings.allowedSymbols}`, warnings, isLive: live };
    }
  }

  try {
    const account = await getAccount();
    const equity = parseFloat(account.equity);
    const estimatedValue = params.limit_price
      ? params.limit_price * params.qty
      : params.qty * 500;

    if (settings.maxOrderValue > 0 && estimatedValue > settings.maxOrderValue) {
      return { allowed: false, reason: `Estimated order value ($${estimatedValue.toFixed(2)}) exceeds maximum order value ($${settings.maxOrderValue})`, warnings, isLive: live };
    }

    if (params.side === "buy") {
      const buyingPower = parseFloat(account.buying_power);
      if (estimatedValue > buyingPower) {
        return { allowed: false, reason: `Insufficient buying power. Need ~$${estimatedValue.toFixed(2)}, have $${buyingPower.toFixed(2)}`, warnings, isLive: live };
      }

      if (estimatedValue > equity * 0.25) {
        warnings.push(`This order is more than 25% of your total equity ($${equity.toFixed(2)})`);
      }

      if (settings.maxEquityExposure > 0) {
        try {
          const positions = await getPositions();
          const totalExposure = positions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value)), 0);
          const exposureAfter = totalExposure + estimatedValue;
          const maxExposureValue = equity * (settings.maxEquityExposure / 100);
          if (exposureAfter > maxExposureValue) {
            return { allowed: false, reason: `Order would exceed equity exposure cap (${settings.maxEquityExposure}%). Current exposure: $${totalExposure.toFixed(0)}, after order: $${exposureAfter.toFixed(0)}, cap: $${maxExposureValue.toFixed(0)}`, warnings, isLive: live };
          }
          if (exposureAfter > maxExposureValue * 0.9) {
            warnings.push(`Approaching equity exposure cap: $${exposureAfter.toFixed(0)} of $${maxExposureValue.toFixed(0)} (${settings.maxEquityExposure}%)`);
          }
        } catch {
          warnings.push("Could not verify equity exposure");
        }
      }
    }

    const lastEquity = parseFloat(account.last_equity);
    const dayLoss = lastEquity - equity;
    if (dayLoss > 0 && settings.maxDailyLoss > 0 && dayLoss >= settings.maxDailyLoss) {
      return { allowed: false, reason: `Daily loss limit reached. Lost $${dayLoss.toFixed(2)} today (limit: $${settings.maxDailyLoss})`, warnings, isLive: live };
    }
    if (dayLoss > 0 && dayLoss > settings.maxDailyLoss * 0.8) {
      warnings.push(`Approaching daily loss limit: $${dayLoss.toFixed(2)} of $${settings.maxDailyLoss} max`);
    }
  } catch {
    warnings.push("Could not verify account balances");
  }

  const dailyCount = getDailyOrderCount();
  if (settings.maxDailyOrders > 0 && dailyCount >= settings.maxDailyOrders) {
    return { allowed: false, reason: `Daily order limit reached (${dailyCount}/${settings.maxDailyOrders})`, warnings, isLive: live };
  }
  if (dailyCount >= settings.maxDailyOrders * 0.8) {
    warnings.push(`Approaching daily order limit: ${dailyCount}/${settings.maxDailyOrders}`);
  }

  if (live) {
    warnings.push("LIVE TRADING: This order will use real money");
  }

  return { allowed: true, warnings, isLive: live };
}

export function recordOrderPlaced(): void {
  incrementDailyOrderCount();
}

export async function preflightCheck(params: {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type: string;
  limit_price?: number;
}): Promise<{
  estimatedValue: number;
  accountEquity: number;
  buyingPower: number;
  dailyOrderCount: number;
  maxDailyOrders: number;
  dailyPL: number;
  maxDailyLoss: number;
  isLive: boolean;
  warnings: string[];
}> {
  const settings = await storage.getSettings();
  const warnings: string[] = [];
  const live = isLiveTrading();

  let accountEquity = 0;
  let buyingPower = 0;
  let dailyPL = 0;

  try {
    const account = await getAccount();
    accountEquity = parseFloat(account.equity);
    buyingPower = parseFloat(account.buying_power);
    const lastEquity = parseFloat(account.last_equity);
    dailyPL = accountEquity - lastEquity;
  } catch {
    warnings.push("Could not fetch account data");
  }

  const estimatedValue = params.limit_price
    ? params.limit_price * params.qty
    : params.qty * 500;

  if (live) warnings.push("LIVE TRADING MODE — Real money will be used");

  return {
    estimatedValue,
    accountEquity,
    buyingPower,
    dailyOrderCount: getDailyOrderCount(),
    maxDailyOrders: settings.maxDailyOrders,
    dailyPL,
    maxDailyLoss: settings.maxDailyLoss,
    isLive: live,
    warnings,
  };
}
