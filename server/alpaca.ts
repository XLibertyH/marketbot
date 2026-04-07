import { storage } from "./storage";

function getBaseUrl(): string {
  return storage.getApiKey("ALPACA_BASE_URL") || process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";
}

function isLiveTrading(): boolean {
  const base = getBaseUrl();
  return base.includes("api.alpaca.markets") && !base.includes("paper");
}

function getHeaders(): Record<string, string> {
  const key = storage.getApiKey("ALPACA_API_KEY") || process.env.ALPACA_API_KEY;
  const secret = storage.getApiKey("ALPACA_SECRET_KEY") || process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) throw new Error("Alpaca API keys not configured");
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    "Content-Type": "application/json",
  };
}

async function alpacaGet(base: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { headers: getHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function alpacaPost(path: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function alpacaDelete(path: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Alpaca API error ${res.status}: ${text}`);
  }
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  account_blocked: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  qty: string;
  avg_entry_price: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  filled_avg_price: string | null;
  status: string;
  extended_hours: boolean;
}

export { isLiveTrading };

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaGet(getBaseUrl(), "/v2/account");
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaGet(getBaseUrl(), "/v2/positions");
}

export async function getPosition(symbol: string): Promise<AlpacaPosition> {
  return alpacaGet(getBaseUrl(), `/v2/positions/${symbol}`);
}

export async function getOrders(status: string = "all", limit: number = 50): Promise<AlpacaOrder[]> {
  return alpacaGet(getBaseUrl(), "/v2/orders", { status, limit: limit.toString(), direction: "desc" });
}

export async function placeOrder(params: {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  time_in_force: "day" | "gtc" | "ioc" | "fok";
  limit_price?: number;
  stop_price?: number;
}): Promise<AlpacaOrder> {
  const body: Record<string, any> = {
    symbol: params.symbol,
    qty: params.qty.toString(),
    side: params.side,
    type: params.type,
    time_in_force: params.time_in_force,
  };
  if (params.limit_price !== undefined) body.limit_price = params.limit_price.toString();
  if (params.stop_price !== undefined) body.stop_price = params.stop_price.toString();
  return alpacaPost("/v2/orders", body);
}

export async function cancelOrder(orderId: string): Promise<void> {
  return alpacaDelete(`/v2/orders/${orderId}`);
}

export async function cancelAllOrders(): Promise<void> {
  return alpacaDelete("/v2/orders");
}

export async function closePosition(symbol: string): Promise<AlpacaOrder> {
  const res = await fetch(`${getBaseUrl()}/v2/positions/${symbol}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
}

export async function getPortfolioHistory(
  period: string = "1M",
  timeframe: string = "1D"
): Promise<AlpacaPortfolioHistory> {
  return alpacaGet(getBaseUrl(), "/v2/account/portfolio/history", { period, timeframe });
}

export async function isAlpacaConnected(): Promise<boolean> {
  try {
    await getAccount();
    return true;
  } catch {
    return false;
  }
}
