import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

const STOCK_PRICES: Record<string, number> = {
  // Mega-caps
  AAPL: 178.50, GOOGL: 141.80, MSFT: 378.90, TSLA: 248.30, AMZN: 178.25,
  META: 485.60, NVDA: 875.40, NFLX: 628.70, AMD: 165.20, INTC: 42.80,
  DIS: 112.40, BA: 205.60, JPM: 195.30, V: 278.90, WMT: 165.40,
  // Volatile small-caps
  PLTR: 25.40, SOFI: 10.80, RIOT: 12.30, MARA: 18.50, UPST: 35.20,
  AFRM: 45.60, IONQ: 15.90, RKLB: 8.40, CLOV: 3.20, STEM: 4.10,
  // Mid-cap growth
  CRWD: 350.20, DDOG: 130.50, NET: 95.30, SQ: 80.40, SHOP: 75.60,
  COIN: 250.30, ROKU: 70.20, DKNG: 45.80, SNOW: 170.40, ENPH: 120.50,
  // Biotech / pharma
  MRNA: 115.30, CRSP: 62.40, BEAM: 28.50, ARKG: 35.20, DNA: 2.80,
  EDIT: 8.90, NTLA: 18.40, RXRX: 7.60,
  // Energy / clean tech
  PLUG: 5.20, FSLR: 180.40, SEDG: 60.30, RUN: 15.80, CHPT: 2.40,
  // Materials / mining
  ALB: 120.50, LAC: 8.30, MP: 18.40, LTHM: 22.60,
  // Space / defense
  JOBY: 6.80, ASTS: 22.30, RDW: 5.60,
  // Fintech / crypto-adjacent
  HOOD: 20.40, RIVN: 14.60, LCID: 3.80, SMCI: 900.20,
  // Meme / high-volatility
  GME: 28.40, AMC: 5.20, BBBY: 0.80, SPCE: 2.10,
};

function jitter(base: number, pct: number = 0.02): number {
  return base * (1 + (Math.random() - 0.5) * 2 * pct);
}

export function getMockQuote(symbol: string): StockQuote {
  const base = STOCK_PRICES[symbol] || 100 + Math.random() * 200;
  const price = jitter(base, 0.015);
  const previousClose = jitter(base, 0.01);

  // ~12% chance of a big mover (5-18% daily swing) to simulate unusual activity
  const isBigMover = Math.random() < 0.12;
  let change: number;
  if (isBigMover) {
    const bigMovePct = (0.05 + Math.random() * 0.13) * (Math.random() > 0.4 ? 1 : -1);
    change = previousClose * bigMovePct;
  } else {
    change = price - previousClose;
  }

  const actualPrice = isBigMover ? previousClose + change : price;

  return {
    symbol,
    price: +actualPrice.toFixed(2),
    change: +change.toFixed(2),
    changePercent: +((change / previousClose) * 100).toFixed(2),
    high: +(actualPrice * (1 + Math.random() * 0.02)).toFixed(2),
    low: +(actualPrice * (1 - Math.random() * 0.02)).toFixed(2),
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
  // Classic headlines
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
  // Small-cap / catalyst headlines
  { h: "{symbol} Receives FDA Fast Track Designation for Lead Drug Candidate", s: 0.9 },
  { h: "Short Squeeze Alert: {symbol} Short Interest Surges to 35%", s: 0.7 },
  { h: "{symbol} Reports Record Revenue, Stock Surges After Hours", s: 0.85 },
  { h: "{symbol} Secures $500M Department of Defense Contract", s: 0.8 },
  { h: "Analyst Initiates Coverage of {symbol} with Outperform Rating", s: 0.65 },
  { h: "{symbol} Announces Breakthrough in Quantum Computing Technology", s: 0.75 },
  { h: "{symbol} Granted Key Patent for Next-Gen Battery Technology", s: 0.7 },
  { h: "{symbol} Reports Massive Insider Buying from Multiple Executives", s: 0.6 },
  { h: "Biotech Catalyst: {symbol} Phase 3 Trial Results Due This Week", s: 0.55 },
  { h: "{symbol} Added to Russell 2000 Index, Triggering Fund Buying", s: 0.65 },
  { h: "{symbol} Warns of Potential Dilution with Secondary Offering", s: -0.8 },
  { h: "{symbol} Loses Major Customer, Revenue Impact Expected at 20%", s: -0.85 },
  { h: "Solar Installations Surge 40%: {symbol} Among Top Beneficiaries", s: 0.7 },
  { h: "Crypto Mining Revenue Jumps as Bitcoin Hits New High — {symbol} Positioned Well", s: 0.75 },
  { h: "{symbol} Space Launch Success Opens Door to $2B Commercial Market", s: 0.8 },
  { h: "{symbol} EV Deliveries Miss Estimates by Wide Margin", s: -0.7 },
  { h: "Rare Earth Supply Crunch Benefits {symbol} as Prices Surge", s: 0.7 },
  { h: "{symbol} CFO Resigns Amid Accounting Irregularities Investigation", s: -0.9 },
];

const SOURCES = [
  "Reuters", "Bloomberg", "CNBC", "MarketWatch", "WSJ", "Barron's",
  "Financial Times", "Yahoo Finance", "Seeking Alpha", "Benzinga",
  "The Motley Fool", "Investor's Business Daily",
];

// Time-varying modifiers that make headlines unique per cycle
const TIME_TAGS = ["Pre-Market", "After Hours", "Midday Update", "Breaking", "Developing", "Just In", "Alert", "Update"];
const PRICE_MOVES = ["+3.5%", "+5.2%", "-4.1%", "+8.7%", "-2.3%", "+12.4%", "-6.8%", "+2.1%", "-9.5%", "+15.3%"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

export function getMockNews(symbol: string, count: number = 5) {
  const shuffled = [...HEADLINES].sort(() => Math.random() - 0.5);
  const now = new Date();
  const tag = TIME_TAGS[Math.floor(Math.random() * TIME_TAGS.length)];
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;

  return shuffled.slice(0, count).map((item, i) => {
    const published = new Date();
    published.setMinutes(published.getMinutes() - Math.floor(Math.random() * 120));
    const move = PRICE_MOVES[Math.floor(Math.random() * PRICE_MOVES.length)];
    const quarter = QUARTERS[Math.floor(Math.random() * QUARTERS.length)];
    // Make headline unique with time-varying suffix
    const headline = item.h
      .replace("{symbol}", symbol)
      .replace("Quarterly", `${quarter}`)
      .replace("Q4", quarter)
      + ` (${tag} ${timeStr})`;

    return {
      symbol,
      headline,
      summary: `Analysis and coverage of ${symbol} market activity and recent developments impacting investor sentiment. Stock moved ${move} today.`,
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
