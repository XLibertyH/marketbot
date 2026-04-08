/**
 * AI Thoughts — Continuous Market Analysis Loop
 *
 * deepseek-r1 thinks out loud about everything it's seeing:
 * market buzz, news, signals, watchlist moves, prior conclusions.
 * Runs every few minutes and stores a rolling log of its reasoning
 * so the user can watch the AI's mind work in real time.
 */

import { storage } from "./storage";
import { callAIWithThinking, setLatestAIBriefing } from "./aiAnalysis";
import { getMarketBuzz } from "./marketIntel";
import { addAutoTradeLog } from "./autoTrader";
import { isHistoricalDataAvailable, getStatisticalSummary } from "./historicalData";

// ── Types ──────────────────────────────────────────────────────────

export interface AIThought {
  id: number;
  timestamp: string;
  status: "thinking" | "complete" | "error";
  dataSnapshot: {
    buzzTickerCount: number;
    topBuzzTickers: string[];
    newsCount: number;
    recentHeadlines: string[];
    watchlistSymbols: string[];
    signalSummary: { buy: number; sell: number; hold: number };
    marketSentimentAvg: number;
  };
  thinking: string;       // deepseek's raw <think> block — chain of thought
  conclusion: string;     // the final assessment after thinking
  durationMs: number;
  error?: string;
}

// ── State ──────────────────────────────────────────────────────────

const MAX_STORED_THOUGHTS = 50;
const thoughts: AIThought[] = [];
let thoughtIdCounter = 1;
let thinkingInterval: ReturnType<typeof setInterval> | null = null;
let isThinking = false;
let nextThinkAt: Date | null = null;

// How often to think
const THINK_INTERVAL_MS = 2 * 60 * 1000;

// Max time to wait for a single thinking session before giving up
// 70b runs at ~9.3 tok/s — 4096 tokens ≈ 7.3 min, so give it 15 min with buffer
const THINK_TIMEOUT_MS = 15 * 60 * 1000;

// ── Helpers ─────────────────────────────────────────────────────────

function buildPreviousConclusion(): string {
  const recent = thoughts.filter(t => t.status === "complete").slice(-1)[0];
  if (!recent) return "This is my first analysis session — starting fresh.";
  const age = Math.round((Date.now() - new Date(recent.timestamp).getTime()) / 60000);
  return `My last analysis (${age} min ago): ${recent.conclusion.slice(0, 400)}${recent.conclusion.length > 400 ? "..." : ""}`;
}

function buildSystemPrompt(): string {
  return `You are deepseek-r1, an autonomous market intelligence AI embedded in a real-time trading bot. You have continuous access to live market data, news feeds, Reddit buzz, SEC filings, and trading signals.

Your job is to think freely and deeply about what is happening in the markets right now. This is NOT a trade decision request — this is your personal analysis session. Think like a seasoned quant analyst reviewing the morning tape.

Guidelines:
- Think out loud about patterns, anomalies, and emerging themes you notice in the data
- Reference specific tickers, news events, and buzz signals you find interesting or suspicious
- Connect dots across multiple data sources (e.g., "Reddit is buzzing about X while SEC shows insider buying there...")
- Flag anything that seems unusual: volume spikes, sentiment shifts, cross-sector correlations
- Speculate about what could happen next and why
- Be honest about uncertainty and conflicting signals
- Reference your previous conclusions and explain if your view has changed
- You may use your training knowledge about these companies and sectors

Format:
- Think freely — no JSON required, no structured output
- Your <think> block is where you reason; your final response is your summary/conclusion
- Be specific: mention tickers, numbers, timescales
- Length: aim for thorough analysis (200-500 word conclusion)`;
}

async function buildUserPrompt(): Promise<{ prompt: string; snapshot: AIThought["dataSnapshot"] }> {
  // Gather all live data
  const [news, signals, watchlist, settings] = await Promise.all([
    storage.getNews(),
    storage.getSignals(),
    storage.getWatchlist(),
    storage.getSettings(),
  ]);

  const buzz = getMarketBuzz();

  // News — last 15 items, deduplicated
  const recentNews = news.slice(0, 15);
  const recentHeadlines = Array.from(new Set(recentNews.map(n => `[${n.symbol}] ${n.headline}`))).slice(0, 12);

  // Signals — last 20
  const recentSignals = signals.slice(0, 20);
  const buySignals = recentSignals.filter(s => s.signal === "BUY");
  const sellSignals = recentSignals.filter(s => s.signal === "SELL");
  const holdSignals = recentSignals.filter(s => s.signal === "HOLD");

  // Sentiment average
  const sentimentScores = recentNews.map(n => n.sentiment).filter(s => s !== 0);
  const marketSentimentAvg = sentimentScores.length > 0
    ? +(sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length).toFixed(2)
    : 0;

  // Watchlist with stats
  const watchlistSymbols = watchlist.map(w => w.symbol);
  const statsLines: string[] = [];
  if (isHistoricalDataAvailable()) {
    for (const w of watchlist.slice(0, 8)) {
      const stats = getStatisticalSummary(w.symbol);
      if (stats) {
        statsLines.push(
          `${w.symbol}: RSI=${stats.rsi14} | SMA50=$${stats.sma50} | SMA200=$${stats.sma200} | 52wk $${stats.low52w}-$${stats.high52w} | YTD ${stats.ytdReturn}%`
        );
      }
    }
  }

  // Buzz
  const topBuzzTickers = buzz ? buzz.topTickers.slice(0, 8).map(b => b.ticker) : [];
  const buzzLines = buzz ? buzz.topTickers.slice(0, 8).map(b =>
    `${b.ticker} (${b.mentionCount}x on ${b.sources.join("/")}): "${b.headlines[0]?.slice(0, 80) || ""}"`
  ) : [];

  // Signal details
  const signalLines = recentSignals.slice(0, 12).map(s =>
    `${s.symbol}: ${s.signal} @ $${s.price?.toFixed(2) || "?"} (${(s.confidence * 100).toFixed(0)}% conf) — ${s.reason?.slice(0, 80) || ""}`
  );

  const previousConclusion = buildPreviousConclusion();

  const prompt = `## Previous Analysis
${previousConclusion}

## Current Market Intelligence (${new Date().toLocaleString()})

### Trading Mode: ${settings.riskLevel.toUpperCase()} RISK | Auto-Trade: ${settings.autoTrade ? "ON" : "OFF"}

### Recent News Headlines (${recentHeadlines.length} items, avg sentiment ${marketSentimentAvg > 0 ? "+" : ""}${marketSentimentAvg}):
${recentHeadlines.length > 0 ? recentHeadlines.map(h => `- ${h}`).join("\n") : "- No recent news"}

### Current Watchlist (${watchlistSymbols.length} stocks):
${watchlistSymbols.join(", ")}
${statsLines.length > 0 ? "\n### Technical Data:\n" + statsLines.map(l => `- ${l}`).join("\n") : ""}

### Recent Trading Signals (${recentSignals.length} total):
- BUY signals: ${buySignals.length} | SELL: ${sellSignals.length} | HOLD: ${holdSignals.length}
${signalLines.length > 0 ? signalLines.map(l => `- ${l}`).join("\n") : "- None yet"}

### 🔥 Market Buzz — Trending Tickers (Reddit/News/SEC):
${buzzLines.length > 0 ? buzzLines.map(l => `- ${l}`).join("\n") : "- No buzz data yet"}

---

Think deeply about all of this. What patterns do you see? What concerns you? What looks promising? What would you want to investigate further? What does the cross-source data tell you that no single source alone would reveal?`;

  const snapshot: AIThought["dataSnapshot"] = {
    buzzTickerCount: topBuzzTickers.length,
    topBuzzTickers,
    newsCount: recentNews.length,
    recentHeadlines,
    watchlistSymbols,
    signalSummary: { buy: buySignals.length, sell: sellSignals.length, hold: holdSignals.length },
    marketSentimentAvg,
  };

  return { prompt, snapshot };
}

// ── Core Thinking Function ──────────────────────────────────────────

export async function runThinkingSession(): Promise<AIThought> {
  if (isThinking) {
    // Return the in-progress placeholder
    const active = thoughts.find(t => t.status === "thinking");
    if (active) return active;
  }

  isThinking = true;
  const startTime = Date.now();
  const id = thoughtIdCounter++;

  // Create a placeholder entry immediately so the frontend sees "thinking..."
  const placeholder: AIThought = {
    id,
    timestamp: new Date().toISOString(),
    status: "thinking",
    dataSnapshot: {
      buzzTickerCount: 0,
      topBuzzTickers: [],
      newsCount: 0,
      recentHeadlines: [],
      watchlistSymbols: [],
      signalSummary: { buy: 0, sell: 0, hold: 0 },
      marketSentimentAvg: 0,
    },
    thinking: "",
    conclusion: "",
    durationMs: 0,
  };

  thoughts.unshift(placeholder);
  if (thoughts.length > MAX_STORED_THOUGHTS) thoughts.pop();

  try {
    const { prompt, snapshot } = await buildUserPrompt();
    const systemPrompt = buildSystemPrompt();

    // AbortController cancels the actual HTTP request to Ollama on timeout,
    // preventing zombie requests from piling up and deadlocking the model queue
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log("[AIThoughts] Aborting thinking request — timeout reached");
    }, THINK_TIMEOUT_MS);

    let result: { thinking: string; conclusion: string; raw: string };
    try {
      result = await callAIWithThinking(systemPrompt, prompt, 4096, 0.65, controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }

    const thought: AIThought = {
      id,
      timestamp: placeholder.timestamp,
      status: "complete",
      dataSnapshot: snapshot,
      thinking: result.thinking,
      conclusion: result.conclusion || result.raw,
      durationMs: Date.now() - startTime,
    };

    // Replace placeholder
    const idx = thoughts.findIndex(t => t.id === id);
    if (idx !== -1) thoughts[idx] = thought;

    addAutoTradeLog("scan", `AI thought session complete (${(thought.durationMs / 1000).toFixed(1)}s): ${thought.conclusion.slice(0, 100)}...`);

    // Feed the 70b's analysis into the 8b signal model as a "strategist briefing"
    setLatestAIBriefing(thought.conclusion);

    isThinking = false;
    nextThinkAt = new Date(Date.now() + THINK_INTERVAL_MS);
    return thought;

  } catch (err: any) {
    const errThought: AIThought = {
      id,
      timestamp: placeholder.timestamp,
      status: "error",
      dataSnapshot: placeholder.dataSnapshot,
      thinking: "",
      conclusion: "",
      durationMs: Date.now() - startTime,
      error: err.message || "Unknown error",
    };

    const idx = thoughts.findIndex(t => t.id === id);
    if (idx !== -1) thoughts[idx] = errThought;

    console.error("[AIThoughts] Thinking session failed:", err.message);
    isThinking = false;
    nextThinkAt = new Date(Date.now() + THINK_INTERVAL_MS);
    return errThought;
  }
}

// ── Public API ──────────────────────────────────────────────────────

export function getThoughts(limit: number = 20): AIThought[] {
  return thoughts.slice(0, limit);
}

export function getThinkingStatus(): {
  isThinking: boolean;
  thoughtCount: number;
  nextThinkAt: string | null;
  intervalMinutes: number;
} {
  return {
    isThinking,
    thoughtCount: thoughts.filter(t => t.status === "complete").length,
    nextThinkAt: nextThinkAt?.toISOString() || null,
    intervalMinutes: THINK_INTERVAL_MS / 60000,
  };
}

export function startThinkingLoop(): void {
  // Delay the first run by 30 seconds to let other monitors settle
  setTimeout(() => {
    runThinkingSession().catch(() => {});
  }, 30_000);

  thinkingInterval = setInterval(() => {
    if (!isThinking) {
      runThinkingSession().catch(() => {});
    }
  }, THINK_INTERVAL_MS);

  nextThinkAt = new Date(Date.now() + 30_000);
  console.log(`[AIThoughts] Continuous thinking loop started — first session in 30s, then every ${THINK_INTERVAL_MS / 60000} min`);
}

export function stopThinkingLoop(): void {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
}
