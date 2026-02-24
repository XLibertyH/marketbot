import OpenAI from "openai";
import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function analyzeStock(
  symbol: string,
  quote: StockQuote,
  history: HistoricalDataPoint[],
  newsHeadlines: string[]
): Promise<{ signal: string; confidence: number; reason: string }> {
  const recentHistory = history.slice(-10);
  const prompt = `You are a stock trading analyst AI. Analyze the following data for ${symbol} and provide a trading signal.

Current Quote:
- Price: $${quote.price}
- Change: ${quote.change} (${quote.changePercent}%)
- High: $${quote.high}, Low: $${quote.low}
- Volume: ${quote.volume.toLocaleString()}

Recent Price History (last 10 trading days):
${recentHistory.map(d => `${d.date}: O:$${d.open} H:$${d.high} L:$${d.low} C:$${d.close} V:${d.volume.toLocaleString()}`).join("\n")}

Recent News Headlines:
${newsHeadlines.length > 0 ? newsHeadlines.map(h => `- ${h}`).join("\n") : "- No recent news available"}

Respond with ONLY valid JSON in this exact format:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "confidence": number between 0.0 and 1.0,
  "reason": "Brief 1-2 sentence explanation of your analysis"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 200,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        signal: parsed.signal || "HOLD",
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        reason: parsed.reason || "Analysis complete.",
      };
    }
  } catch (error) {
    console.error("AI analysis error:", error);
  }

  return {
    signal: "HOLD",
    confidence: 0.5,
    reason: "Unable to generate AI analysis. Using default HOLD recommendation.",
  };
}
