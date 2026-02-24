import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

const STOCK_PRICES: Record<string, number> = {
  AAPL: 178.50, GOOGL: 141.80, MSFT: 378.90, TSLA: 248.30, AMZN: 178.25,
  META: 485.60, NVDA: 875.40, NFLX: 628.70, AMD: 165.20, INTC: 42.80,
  DIS: 112.40, BA: 205.60, JPM: 195.30, V: 278.90, WMT: 165.40,
};

function jitter(base: number, pct: number = 0.02): number {
  return base * (1 + (Math.random() - 0.5) * 2 * pct);
}

export function getMockQuote(symbol: string): StockQuote {
  const base = STOCK_PRICES[symbol] || 100 + Math.random() * 200;
  const price = jitter(base, 0.015);
  const previousClose = jitter(base, 0.01);
  const change = price - previousClose;
  return {
    symbol,
    price: +price.toFixed(2),
    change: +change.toFixed(2),
    changePercent: +((change / previousClose) * 100).toFixed(2),
    high: +(price * 1.012).toFixed(2),
    low: +(price * 0.988).toFixed(2),
    open: +jitter(base, 0.008).toFixed(2),
    previousClose: +previousClose.toFixed(2),
    volume: Math.floor(Math.random() * 50_000_000) + 5_000_000,
  };
}

export function getMockHistoricalData(symbol: string, days: number = 90): HistoricalDataPoint[] {
  const base = STOCK_PRICES[symbol] || 150;
  const points: HistoricalDataPoint[] = [];
  let price = base * 0.85;

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const dailyChange = (Math.random() - 0.48) * price * 0.03;
    price = Math.max(price + dailyChange, 10);
    const open = price + (Math.random() - 0.5) * price * 0.01;
    const close = price;
    const high = Math.max(open, close) + Math.random() * price * 0.015;
    const low = Math.min(open, close) - Math.random() * price * 0.015;

    points.push({
      date: date.toISOString().split("T")[0],
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.floor(Math.random() * 40_000_000) + 5_000_000,
    });
  }
  return points;
}

const HEADLINES = [
  { h: "{symbol} Reports Strong Quarterly Earnings, Beating Analyst Expectations", s: 0.8 },
  { h: "{symbol} Announces Strategic Partnership to Expand Market Reach", s: 0.6 },
  { h: "Analysts Upgrade {symbol} Following Positive Revenue Growth", s: 0.7 },
  { h: "{symbol} Faces Regulatory Scrutiny Over Business Practices", s: -0.6 },
  { h: "{symbol} Stock Dips Amid Broader Market Selloff", s: -0.4 },
  { h: "{symbol} Launches Innovative New Product Line", s: 0.65 },
  { h: "Insider Trading Report: {symbol} CEO Sells Shares", s: -0.5 },
  { h: "{symbol} Expands AI Capabilities with New Acquisition", s: 0.75 },
  { h: "{symbol} Revenue Forecast Revised Downward for Q4", s: -0.7 },
  { h: "Market Buzz: {symbol} Positioned for Growth in 2025", s: 0.5 },
  { h: "{symbol} Supply Chain Issues May Impact Production", s: -0.45 },
  { h: "Breaking: {symbol} Signs Major Government Contract", s: 0.85 },
];

const SOURCES = ["Reuters", "Bloomberg", "CNBC", "MarketWatch", "WSJ", "Barron's", "Financial Times", "Yahoo Finance"];

export function getMockNews(symbol: string, count: number = 5) {
  const shuffled = [...HEADLINES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((item, i) => {
    const published = new Date();
    published.setHours(published.getHours() - Math.floor(Math.random() * 48));
    return {
      symbol,
      headline: item.h.replace("{symbol}", symbol),
      summary: `Analysis and coverage of ${symbol} market activity and recent developments impacting investor sentiment.`,
      source: SOURCES[Math.floor(Math.random() * SOURCES.length)],
      sentiment: +(item.s + (Math.random() - 0.5) * 0.2).toFixed(2),
      url: null,
      publishedAt: published,
    };
  });
}

export function getMockSignal(symbol: string, price: number) {
  const signals = ["BUY", "SELL", "HOLD"] as const;
  const weights = [0.35, 0.25, 0.4];
  const rand = Math.random();
  let sig: string;
  if (rand < weights[0]) sig = "BUY";
  else if (rand < weights[0] + weights[1]) sig = "SELL";
  else sig = "HOLD";

  const reasons: Record<string, string[]> = {
    BUY: [
      "Strong upward momentum with RSI below 70. Positive news sentiment and volume increase suggest continued uptrend.",
      "Price breakout above 20-day moving average. Bullish MACD crossover confirmed with strong volume.",
      "Oversold conditions detected. Historical support level holding with positive divergence.",
    ],
    SELL: [
      "Bearish divergence detected on RSI. Price approaching strong resistance with declining volume.",
      "Negative news sentiment trend. MACD showing bearish crossover below signal line.",
      "Overbought conditions with RSI above 75. Multiple resistance levels ahead.",
    ],
    HOLD: [
      "Consolidation phase with mixed signals. Wait for clearer direction before entering position.",
      "Price within neutral zone. Balanced buy/sell pressure with average volume.",
      "Market uncertainty high. Risk-reward ratio does not favor new positions at current levels.",
    ],
  };

  const reasonList = reasons[sig];
  return {
    symbol,
    signal: sig,
    confidence: +(0.55 + Math.random() * 0.4).toFixed(2),
    price,
    reason: reasonList[Math.floor(Math.random() * reasonList.length)],
  };
}
