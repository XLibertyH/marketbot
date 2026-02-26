import OpenAI from "openai";
import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "local",
  baseURL: process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MODEL = process.env.OPENAI_MODEL || process.env.AI_INTEGRATIONS_OPENAI_MODEL || "gpt-4o-mini";
const MAX_RETRIES = 2;

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 400
): Promise<string> {
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || "";
      if (content.trim().length > 0) {
        return content;
      }
      lastError = new Error("Empty response from AI");
    } catch (error: any) {
      lastError = error;
      console.error(`AI call attempt ${attempt + 1} failed:`, error.message || error);
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
  newsHeadlines: string[]
): Promise<{ signal: string; confidence: number; reason: string }> {
  const recentHistory = history.slice(-10);

  const systemPrompt = `You are a stock trading analyst. You MUST respond with ONLY a JSON object, no other text. The JSON must have exactly these fields:
- "signal": one of "BUY", "SELL", or "HOLD"
- "confidence": a number between 0.0 and 1.0
- "reason": a brief 1-2 sentence explanation

Example response:
{"signal": "BUY", "confidence": 0.78, "reason": "Strong upward momentum with positive earnings surprise."}`;

  const userPrompt = `Analyze ${symbol}:

Price: $${quote.price} | Change: ${quote.change} (${quote.changePercent}%) | High: $${quote.high} | Low: $${quote.low} | Volume: ${quote.volume.toLocaleString()}

Last 10 days:
${recentHistory.map(d => `${d.date}: O:$${d.open} H:$${d.high} L:$${d.low} C:$${d.close} V:${d.volume.toLocaleString()}`).join("\n")}

News:
${newsHeadlines.length > 0 ? newsHeadlines.slice(0, 5).map(h => `- ${h}`).join("\n") : "- No recent news"}

Respond with JSON only.`;

  try {
    const content = await callAI(systemPrompt, userPrompt, 300);
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
  const systemPrompt = `You are a stock market research AI. You MUST respond with ONLY a JSON array, no other text. Each element must have:
- "symbol": a US stock ticker (1-5 uppercase letters)
- "name": the company name
- "reason": brief reason why it's worth watching

Example response:
[{"symbol": "NVDA", "name": "NVIDIA Corporation", "reason": "AI chip demand surging after new contracts."}]`;

  const userPrompt = `Suggest 1-3 US stocks worth watching that are NOT in this list: ${currentSymbols.join(", ")}.

${recentNews.length > 0 ? `Recent news:\n${recentNews.slice(0, 5).map(h => `- ${h}`).join("\n")}` : "No specific news context."}

Consider trending stocks with strong momentum or sector attention. Respond with JSON array only.`;

  try {
    const content = await callAI(systemPrompt, userPrompt, 400);
    const parsed = extractJSON(content, "array");

    if (Array.isArray(parsed)) {
      return parsed
        .filter((s: any) => s.symbol && s.name && typeof s.symbol === "string")
        .map((s: any) => ({
          symbol: s.symbol.toUpperCase().replace(/[^A-Z]/g, ""),
          name: s.name,
          reason: s.reason || "AI-suggested stock",
        }))
        .slice(0, 3);
    }
  } catch (error: any) {
    console.error("AI stock discovery failed:", error.message || error);
  }

  return [];
}
