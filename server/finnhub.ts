import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

const BASE_URL = "https://finnhub.io/api/v1";

function getApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");
  return key;
}

async function finnhubGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("token", getApiKey());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Finnhub API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getFinnhubQuote(symbol: string): Promise<StockQuote> {
  const data = await finnhubGet("/quote", { symbol });

  if (!data || data.c === 0) {
    throw new Error(`No quote data for ${symbol}`);
  }

  return {
    symbol,
    price: data.c,
    change: +(data.c - data.pc).toFixed(2),
    changePercent: +(((data.c - data.pc) / data.pc) * 100).toFixed(2),
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
    volume: 0,
  };
}

export async function getFinnhubCandles(symbol: string, days: number = 90): Promise<HistoricalDataPoint[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;

  const data = await finnhubGet("/stock/candle", {
    symbol,
    resolution: "D",
    from: from.toString(),
    to: to.toString(),
  });

  if (!data || data.s === "no_data" || !data.c) {
    throw new Error(`No historical data for ${symbol}`);
  }

  const points: HistoricalDataPoint[] = [];
  for (let i = 0; i < data.c.length; i++) {
    const date = new Date(data.t[i] * 1000);
    points.push({
      date: date.toISOString().split("T")[0],
      open: +data.o[i].toFixed(2),
      high: +data.h[i].toFixed(2),
      low: +data.l[i].toFixed(2),
      close: +data.c[i].toFixed(2),
      volume: data.v[i],
    });
  }

  return points;
}

export async function getFinnhubNews(symbol: string, count: number = 5) {
  const to = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const data = await finnhubGet("/company-news", { symbol, from, to });

  if (!Array.isArray(data)) return [];

  return data.slice(0, count).map((item: any) => ({
    symbol,
    headline: item.headline || "No headline",
    summary: item.summary || "No summary available",
    source: item.source || "Unknown",
    sentiment: 0,
    url: item.url || null,
    publishedAt: new Date(item.datetime * 1000),
  }));
}
