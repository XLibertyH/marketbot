import OpenAI from "openai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { StockQuote, HistoricalDataPoint, StatisticalSummary } from "@shared/schema";
import { storage } from "./storage";
import { getMarketBuzz } from "./marketIntel";

// ── AI Mind briefing relay ───────────────────────────────────────────
// The 70b model's latest thinking gets stored here by aiThoughts.ts
// and injected into the 8b model's signal prompts for smarter decisions.
let _latestAIBriefing = "";
export function setLatestAIBriefing(briefing: string): void {
  _latestAIBriefing = briefing.slice(0, 1500); // keep it concise for the 8b's context
}
function getLatestAIBriefing(): string {
  return _latestAIBriefing;
}

export interface SentimentResult {
  headline: string;
  score: number; // -1.0 to 1.0
}

export interface MarketRegime {
  regime: "bullish" | "bearish" | "choppy" | "crisis";
  confidence: number;
  suggestedExposure: number; // 0.0 to 1.0 multiplier
  reason: string;
  detectedAt: string;
}

// Cache regime detection for 30 minutes
let cachedRegime: MarketRegime | null = null;
let regimeCacheTime = 0;
const REGIME_CACHE_MS = 30 * 60 * 1000;

// ── Dual-model Ollama setup ──────────────────────────────────────────
// "Deep" model  = big model for AI Mind thinking sessions (deepseek-r1:70b)
// "Fast" model  = small model for signals, sentiment, discovery (deepseek-r1:8b)
// This prevents the slow 70b model from blocking quick tasks.

let _ollamaClient: OpenAI | null = null;
let _ollamaBaseURL = "";

function getOllamaClient(): OpenAI {
  const baseURL = storage.getApiKey("OLLAMA_BASE_URL") || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
  if (!_ollamaClient || baseURL !== _ollamaBaseURL) {
    _ollamaClient = new OpenAI({ apiKey: "ollama", baseURL, timeout: 10 * 60 * 1000 });
    _ollamaBaseURL = baseURL;
  }
  return _ollamaClient;
}

/** Deep model — used only for AI Mind thinking sessions */
function getDeepModel(): string {
  return storage.getApiKey("OLLAMA_MODEL") || process.env.OLLAMA_MODEL || "deepseek-r1:70b";
}

/** Signal model — mid-tier, used for BUY/SELL/HOLD signal generation (gets 70b briefing) */
function getSignalModel(): string {
  return storage.getApiKey("OLLAMA_SIGNAL_MODEL") || process.env.OLLAMA_SIGNAL_MODEL || "deepseek-r1:14b";
}

/** Fast model — lightweight, used for news sentiment, stock discovery, regime detection */
function getFastModel(): string {
  return storage.getApiKey("OLLAMA_FAST_MODEL") || process.env.OLLAMA_FAST_MODEL || "deepseek-r1:8b";
}

// Re-export for settings UI
export function getModelNames(): { deep: string; signal: string; fast: string } {
  return { deep: getDeepModel(), signal: getSignalModel(), fast: getFastModel() };
}

const MAX_RETRIES = 2;

// Load historical market events for AI context
let marketEventsContext = "";
try {
  const _dir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const eventsPath = join(_dir, "data", "market_events.json");
  const events = JSON.parse(readFileSync(eventsPath, "utf-8"));
  const summaries = events.map((e: any) =>
    `${e.event_name} (${e.start_date}): ${e.category} — S&P500 ${e.market_impact.sp500_drawdown_pct}%, recovery ${e.recovery_time_months}mo. ${e.notes}`
  );
  marketEventsContext = `\n\nHistorical market events for context:\n${summaries.join("\n")}`;
  console.log(`[AI] Loaded ${events.length} historical market events for context`);
} catch (err: any) {
  console.warn("[AI] Could not load market_events.json:", err.message);
}

/**
 * Strip <think>...</think> blocks from deepseek-r1 responses.
 * The model outputs its chain-of-thought inside these tags before the actual answer.
 */
function stripThinkingTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Extract just the <think>...</think> block (the reasoning) from deepseek-r1 responses.
 */
export function extractThinkingContent(content: string): { thinking: string; conclusion: string } {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  const thinking = thinkMatch ? thinkMatch[1].trim() : "";
  const conclusion = stripThinkingTags(content);
  return { thinking, conclusion };
}

/**
 * Like callAI but preserves the <think> block — returns both the reasoning and the conclusion.
 * Used for the AI Thoughts stream so we can display what deepseek is actually thinking.
 */
export async function callAIWithThinking(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096,
  temperature: number = 0.6
): Promise<{ thinking: string; conclusion: string; raw: string }> {
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = getDeepModel();
      console.log(`[AI-Deep] Thinking attempt ${attempt + 1} using ${model}...`);
      const response = await getOllamaClient().chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature,
      });

      const raw = response.choices[0]?.message?.content || "";
      if (raw.length > 0) {
        const { thinking, conclusion } = extractThinkingContent(raw);
        console.log(`[AI-Deep] Thinking complete (${raw.length} chars)`);
        return { thinking, conclusion, raw };
      }
      lastError = new Error("Empty response from AI");
    } catch (error: any) {
      lastError = error;
      console.error(`AI thinking call attempt ${attempt + 1} failed:`, error.message || error);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Call the signal model (14b) — used for BUY/SELL/HOLD decisions.
 * Gets the 70b's strategic briefing baked into the prompt.
 */
async function callSignalAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 2048
): Promise<string> {
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = getSignalModel();
      const response = await getOllamaClient().chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || "";
      const cleaned = stripThinkingTags(content);
      if (cleaned.length > 0) return cleaned;
      lastError = new Error("Empty response from signal AI");
    } catch (error: any) {
      lastError = error;
      console.error(`[AI-Signal] Call attempt ${attempt + 1} failed:`, error.message || error);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Call the fast model (8b) — used for sentiment, discovery, regime detection.
 */
async function callAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 2048
): Promise<string> {
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = getFastModel();
      const response = await getOllamaClient().chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || "";
      const cleaned = stripThinkingTags(content);
      if (cleaned.length > 0) return cleaned;
      lastError = new Error("Empty response from AI");
    } catch (error: any) {
      lastError = error;
      console.error(`[AI-Fast] Call attempt ${attempt + 1} failed:`, error.message || error);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function extractJSON(content: string, type: "object" | "array"): any {
  let cleaned = content.trim();

  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  if (type === "object") {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } else {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  }

  return JSON.parse(cleaned);
}

export async function analyzeStock(
  symbol: string,
  quote: StockQuote,
  history: HistoricalDataPoint[],
  newsHeadlines: string[],
  stats?: StatisticalSummary | null
): Promise<{ signal: string; confidence: number; reason: string }> {
  const recentHistory = history.slice(-10);

  const systemPrompt = `You are a stock trading analyst with access to deep historical data. You MUST respond with ONLY a JSON object, no other text. The JSON must have exactly these fields:
- "signal": one of "BUY", "SELL", or "HOLD"
- "confidence": a number between 0.0 and 1.0
- "reason": a brief 1-2 sentence explanation

Use the statistical profile and historical market pattern knowledge to inform your analysis. Pay attention to RSI levels, moving average crossovers, volatility, and how current price relates to 52-week range.${marketEventsContext}

Example response:
{"signal": "BUY", "confidence": 0.78, "reason": "Strong upward momentum with positive earnings surprise."}`;

  let statsBlock = "";
  if (stats) {
    const pctFrom52wHigh = ((quote.price - stats.high52w) / stats.high52w * 100).toFixed(1);
    const priceVsSMA50 = quote.price > stats.sma50 ? "ABOVE" : "BELOW";
    const priceVsSMA200 = quote.price > stats.sma200 ? "ABOVE" : "BELOW";
    const volRatio = stats.avgVolume20d > 0 ? ((quote.volume / stats.avgVolume20d) * 100).toFixed(0) : "N/A";
    statsBlock = `

Statistical Profile (from 30 years of real data):
- 52-week range: $${stats.low52w} - $${stats.high52w} (current: ${pctFrom52wHigh}% from high)
- Volatility: 20d ${stats.volatility20d}%, 90d ${stats.volatility90d}%
- Moving averages: SMA50=$${stats.sma50} (${priceVsSMA50}), SMA200=$${stats.sma200} (${priceVsSMA200})
- RSI(14): ${stats.rsi14} ${stats.rsi14 > 70 ? "(OVERBOUGHT)" : stats.rsi14 < 30 ? "(OVERSOLD)" : "(neutral)"}
- ATR(14): $${stats.atr14}
- Returns: YTD ${stats.ytdReturn}%, 1Y ${stats.return1y}%, 3Y ${stats.return3y}%, 5Y ${stats.return5y}%
- Volume: current vs 20d avg: ${volRatio}% ${Number(volRatio) > 200 ? "(UNUSUALLY HIGH)" : ""}`;
  }

  // Inject the 70b strategist's latest analysis so the 14b makes better decisions
  const briefing = getLatestAIBriefing();
  const strategistBlock = briefing
    ? `\n\nSenior Strategist Briefing (from deep analysis model — factor this into your decision):\n${briefing}`
    : "";

  // Inject Reddit/RSS/SEC buzz for this specific symbol
  const buzz = getMarketBuzz();
  const symbolBuzz = buzz?.topTickers?.find(t => t.ticker === symbol);
  const buzzBlock = symbolBuzz
    ? `\n\nSocial/Market Buzz for ${symbol} (Reddit/RSS/SEC — ${symbolBuzz.mentionCount} mentions):\n${symbolBuzz.headlines.slice(0, 3).map(h => `- ${h}`).join("\n")}`
    : "";

  const userPrompt = `Analyze ${symbol}:

Price: $${quote.price} | Change: ${quote.change} (${quote.changePercent}%) | High: $${quote.high} | Low: $${quote.low} | Volume: ${quote.volume.toLocaleString()}

Last 10 days:
${recentHistory.map(d => `${d.date}: O:$${d.open} H:$${d.high} L:$${d.low} C:$${d.close} V:${d.volume.toLocaleString()}`).join("\n")}
${statsBlock}
News:
${newsHeadlines.length > 0 ? newsHeadlines.slice(0, 10).map(h => `- ${h}`).join("\n") : "- No recent news"}
${buzzBlock}${strategistBlock}

Respond with JSON only.`;

  try {
    // Route through the 14b signal model (gets 70b briefing in the prompt)
    const content = await callSignalAI(systemPrompt, userPrompt, 2048);
    const parsed = extractJSON(content, "object");

    const signal = ["BUY", "SELL", "HOLD"].includes(parsed.signal?.toUpperCase())
      ? parsed.signal.toUpperCase()
      : "HOLD";

    return {
      signal,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      reason: parsed.reason || "Analysis complete.",
    };
  } catch (error: any) {
    console.error(`AI analysis failed for ${symbol}:`, error.message || error);
  }

  return {
    signal: "HOLD",
    confidence: 0.5,
    reason: "Unable to generate AI analysis. Using default HOLD recommendation.",
  };
}

export async function discoverStocks(
  currentSymbols: string[],
  recentNews: string[]
): Promise<{ symbol: string; name: string; reason: string }[]> {
  const systemPrompt = `You are a stock market research AI specializing in finding HIDDEN GEMS — small-cap and mid-cap stocks that most people overlook. You MUST respond with ONLY a JSON array, no other text. Each element must have:
- "symbol": a US stock ticker (1-5 uppercase letters)
- "name": the company name
- "reason": brief reason why it's worth watching

IMPORTANT RULES:
- Focus on SMALL-CAP and MID-CAP stocks (under $10B market cap)
- DO NOT suggest well-known mega-caps like AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA unless there is a very specific unusual catalyst
- Prioritize stocks with recent catalysts: FDA approvals, earnings surprises, government contracts, short squeezes, insider buying, index additions, sector breakouts
- Consider diverse sectors: biotech, clean energy, space tech, fintech, rare earth mining, quantum computing, cybersecurity, EV supply chain
- Look for stocks that could make 10-20%+ moves based on upcoming catalysts

Use your knowledge of historical market patterns to identify opportunities.${marketEventsContext}

Example response:
[{"symbol": "IONQ", "name": "IonQ Inc", "reason": "Quantum computing contracts accelerating, government funding expected."}]`;

  const userPrompt = `Suggest 2-5 US stocks worth watching that are NOT in this list: ${currentSymbols.join(", ")}.

${recentNews.length > 0 ? `Recent news:\n${recentNews.slice(0, 10).map(h => `- ${h}`).join("\n")}` : "No specific news context."}

Focus on lesser-known stocks with high upside potential — biotech catalysts, clean energy momentum, space tech, fintech disruptors, meme potential, or any sector experiencing unusual activity. Respond with JSON array only.`;

  try {
    const content = await callAI(systemPrompt, userPrompt, 2048);
    const parsed = extractJSON(content, "array");

    if (Array.isArray(parsed)) {
      return parsed
        .filter((s: any) => s.symbol && s.name && typeof s.symbol === "string")
        .map((s: any) => ({
          symbol: s.symbol.toUpperCase().replace(/[^A-Z]/g, ""),
          name: s.name,
          reason: s.reason || "AI-suggested stock",
        }))
        .slice(0, 5);
    }
  } catch (error: any) {
    console.error("AI stock discovery failed:", error.message || error);
  }

  return [];
}

export async function analyzeNewsSentiment(
  headlines: { headline: string; symbol?: string }[]
): Promise<SentimentResult[]> {
  if (headlines.length === 0) return [];

  const batch = headlines.slice(0, 15);

  const systemPrompt = `You are a financial news sentiment analyzer. You MUST respond with ONLY a JSON array, no other text. Each element must have:
- "index": the number of the headline (starting from 1)
- "score": a number from -1.0 (very bearish/negative) to 1.0 (very bullish/positive), 0.0 is neutral

Scoring guide:
- +0.7 to +1.0: Strong positive (FDA approval, earnings beat, major contract win, acquisition at premium)
- +0.3 to +0.6: Moderately positive (analyst upgrade, revenue growth, partnership)
- -0.3 to +0.3: Neutral (routine news, mixed signals)
- -0.6 to -0.3: Moderately negative (earnings miss, downgrade, regulatory concern)
- -1.0 to -0.7: Strong negative (fraud, bankruptcy risk, SEC investigation, massive layoff)

Example response:
[{"index": 1, "score": 0.8}, {"index": 2, "score": -0.5}]`;

  const numbered = batch.map((h, i) => `${i + 1}. ${h.symbol ? `[${h.symbol}] ` : ""}${h.headline}`).join("\n");
  const userPrompt = `Score the sentiment of these financial headlines:\n\n${numbered}\n\nRespond with JSON array only.`;

  try {
    const content = await callAI(systemPrompt, userPrompt, 1024);
    const parsed = extractJSON(content, "array");

    if (Array.isArray(parsed)) {
      return batch.map((h, i) => {
        const match = parsed.find((p: any) => p.index === i + 1);
        return {
          headline: h.headline,
          score: match ? Math.min(1, Math.max(-1, Number(match.score) || 0)) : 0,
        };
      });
    }
  } catch (error: any) {
    console.error("AI sentiment analysis failed:", error.message || error);
  }

  // Fallback: return neutral scores
  return batch.map(h => ({ headline: h.headline, score: 0 }));
}

export async function detectMarketRegime(
  marketHistory: HistoricalDataPoint[]
): Promise<MarketRegime> {
  // Return cached result if still fresh
  if (cachedRegime && Date.now() - regimeCacheTime < REGIME_CACHE_MS) {
    return cachedRegime;
  }

  const recent = marketHistory.slice(-60);
  if (recent.length < 10) {
    const fallback: MarketRegime = {
      regime: "choppy",
      confidence: 0.3,
      suggestedExposure: 0.5,
      reason: "Insufficient market data for regime detection.",
      detectedAt: new Date().toISOString(),
    };
    return fallback;
  }

  // Compute basic market stats for the AI
  const closes = recent.map(d => d.close);
  const peak = Math.max(...closes);
  const current = closes[closes.length - 1];
  const drawdownPct = ((current - peak) / peak * 100).toFixed(1);
  const first = closes[0];
  const trendPct = ((current - first) / first * 100).toFixed(1);

  // Simple volatility
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length;
  const dailyVol = (Math.sqrt(variance) * 100).toFixed(2);
  const annualVol = (Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(1);

  const systemPrompt = `You are a market regime classifier. You MUST respond with ONLY a JSON object, no other text. The JSON must have:
- "regime": one of "bullish", "bearish", "choppy", "crisis"
- "confidence": 0.0 to 1.0
- "suggestedExposure": 0.0 to 1.0 (how much equity exposure is appropriate)
- "reason": brief 1-2 sentence explanation

Regime definitions:
- "bullish": Uptrend, low drawdown, moderate volatility. Exposure: 0.8-1.0
- "bearish": Downtrend, negative returns, increasing volatility. Exposure: 0.3-0.6
- "choppy": No clear trend, mixed signals, elevated volatility. Exposure: 0.4-0.7
- "crisis": Severe drawdown (>15%), extreme volatility, systemic risk. Exposure: 0.0-0.2${marketEventsContext}

Example response:
{"regime": "bullish", "confidence": 0.82, "suggestedExposure": 0.9, "reason": "Strong uptrend with low volatility and minimal drawdown."}`;

  const priceTable = recent.slice(-20).map(d =>
    `${d.date}: O:$${d.open} H:$${d.high} L:$${d.low} C:$${d.close} V:${d.volume.toLocaleString()}`
  ).join("\n");

  const userPrompt = `Classify the current market regime based on broad market data:

Period: ${recent[0].date} to ${recent[recent.length - 1].date} (${recent.length} days)
Current price: $${current.toFixed(2)}
Period trend: ${trendPct}%
Drawdown from peak: ${drawdownPct}%
Daily volatility: ${dailyVol}%
Annualized volatility: ${annualVol}%

Last 20 days:
${priceTable}

Respond with JSON only.`;

  try {
    const content = await callAI(systemPrompt, userPrompt, 1024);
    const parsed = extractJSON(content, "object");

    const validRegimes = ["bullish", "bearish", "choppy", "crisis"];
    const regime: MarketRegime = {
      regime: validRegimes.includes(parsed.regime) ? parsed.regime : "choppy",
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      suggestedExposure: Math.min(1, Math.max(0, Number(parsed.suggestedExposure) || 0.5)),
      reason: parsed.reason || "Market regime assessed.",
      detectedAt: new Date().toISOString(),
    };

    cachedRegime = regime;
    regimeCacheTime = Date.now();
    return regime;
  } catch (error: any) {
    console.error("AI regime detection failed:", error.message || error);
  }

  const fallback: MarketRegime = {
    regime: "choppy",
    confidence: 0.3,
    suggestedExposure: 0.5,
    reason: "Unable to classify market regime. Using cautious default.",
    detectedAt: new Date().toISOString(),
  };
  cachedRegime = fallback;
  regimeCacheTime = Date.now();
  return fallback;
}
