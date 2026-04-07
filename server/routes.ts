import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, isAllowedApiKey } from "./storage";
import { getFinnhubQuote, getFinnhubCandles, getFinnhubNews, getFinnhubMarketNews } from "./finnhub";
import { getAccount, getPositions, getOrders, placeOrder, cancelOrder, cancelAllOrders, closePosition, isAlpacaConnected, isLiveTrading, getPortfolioHistory } from "./alpaca";
import { validateOrder, recordOrderPlaced, preflightCheck } from "./tradingGuards";
import { analyzeStock } from "./aiAnalysis";
import { getAutoTradeLog, getAutoTradeStatus, restartAutoTrader, startAutoTrader } from "./autoTrader";
import { getKellyStats } from "./kellyCriterion";
import { startNewsMonitor, stopNewsMonitor, restartNewsMonitor, isNewsMonitorRunning } from "./newsMonitor";
import { getMarketBuzz, startMarketIntelMonitor } from "./marketIntel";
import { getThoughts, getThinkingStatus, runThinkingSession, startThinkingLoop } from "./aiThoughts";
import { isHistoricalDataAvailable, getHistoricalPrices, getStatisticalSummary } from "./historicalData";
import { insertWatchlistSchema, insertBotSettingsSchema } from "@shared/schema";
import type { StockQuote, HistoricalDataPoint } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/settings", async (_req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const partial = insertBotSettingsSchema.partial().safeParse(req.body);
      if (!partial.success) return res.status(400).json({ error: partial.error.message });
      const settings = await storage.updateSettings(partial.data);

      if (req.body.autoTrade !== undefined || req.body.autoTradeInterval !== undefined) {
        await restartAutoTrader();
      }

      if (req.body.simulationMode !== undefined) {
        await restartNewsMonitor();
      }

      res.json(settings);
    } catch (error) {
      res.status(400).json({ error: "Invalid settings" });
    }
  });

  app.get("/api/watchlist", async (_req, res) => {
    const items = await storage.getWatchlist();
    res.json(items);
  });

  app.post("/api/watchlist", async (req, res) => {
    const parsed = insertWatchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const item = await storage.addWatchlistItem(parsed.data);
    res.json(item);
  });

  app.delete("/api/watchlist/:id", async (req, res) => {
    await storage.removeWatchlistItem(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // Build quotes from Alpaca positions (real prices, no mock data)
  app.get("/api/quotes", async (_req, res) => {
    try {
      const positions = await getPositions();
      const quotes: StockQuote[] = positions.map(p => ({
        symbol: p.symbol,
        price: parseFloat(p.current_price),
        change: parseFloat(p.current_price) - parseFloat(p.lastday_price),
        changePercent: +(parseFloat(p.change_today) * 100).toFixed(2),
        high: parseFloat(p.current_price),
        low: parseFloat(p.current_price),
        open: parseFloat(p.lastday_price),
        previousClose: parseFloat(p.lastday_price),
        volume: 0,
      }));
      res.json(quotes);
    } catch {
      res.json([]);
    }
  });

  app.get("/api/quote/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    try {
      // Try Alpaca position first (free, no extra key needed)
      const position = await getPositions();
      const match = position.find(p => p.symbol === symbol);
      if (match) {
        return res.json({
          symbol,
          price: parseFloat(match.current_price),
          change: parseFloat(match.current_price) - parseFloat(match.lastday_price),
          changePercent: +(parseFloat(match.change_today) * 100).toFixed(2),
          high: parseFloat(match.current_price),
          low: parseFloat(match.current_price),
          open: parseFloat(match.lastday_price),
          previousClose: parseFloat(match.lastday_price),
          volume: 0,
        });
      }
      // Fallback to Finnhub if available
      res.json(await getFinnhubQuote(symbol));
    } catch {
      res.status(503).json({ error: `No price data available for ${symbol}` });
    }
  });

  app.get("/api/history/:symbol", async (req, res) => {
    const days = parseInt(req.query.days as string) || 90;
    const symbol = req.params.symbol.toUpperCase();
    try {
      res.json(await getFinnhubCandles(symbol, days));
    } catch {
      if (isHistoricalDataAvailable()) {
        const data = getHistoricalPrices(symbol, days);
        if (data && data.length > 0) return res.json(data);
      }
      res.json([]); // No data — don't fake it
    }
  });

  // Portfolio equity history from Alpaca (for dashboard chart)
  app.get("/api/portfolio/history", async (req, res) => {
    const period = (req.query.period as string) || "1M";
    const timeframe = (req.query.timeframe as string) || "1D";
    try {
      const history = await getPortfolioHistory(period, timeframe);
      // Transform to chart-friendly format
      const points = (history.timestamp || []).map((ts: number, i: number) => ({
        date: new Date(ts * 1000).toISOString().split("T")[0],
        equity: history.equity[i],
        profitLoss: history.profit_loss[i],
        profitLossPct: history.profit_loss_pct[i],
      }));
      res.json({ baseValue: history.base_value, timeframe: history.timeframe, points });
    } catch (err: any) {
      res.status(503).json({ error: err.message || "Portfolio history unavailable" });
    }
  });

  app.get("/api/stats/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    if (!isHistoricalDataAvailable()) {
      return res.status(503).json({ error: "Historical database not loaded" });
    }
    const stats = getStatisticalSummary(symbol);
    if (!stats) {
      return res.status(404).json({ error: `No historical data for ${symbol}` });
    }
    res.json(stats);
  });

  app.get("/api/news", async (req, res) => {
    const symbol = req.query.symbol as string;
    try {
      if (symbol === "MARKET") {
        const marketNews = await getFinnhubMarketNews(20);
        for (const n of marketNews) await storage.addNews({ symbol: "MARKET", headline: n.headline, summary: n.summary, source: n.source, sentiment: 0, url: n.url });
        return res.json(await storage.getNews("MARKET"));
      } else if (symbol) {
        const liveNews = await getFinnhubNews(symbol.toUpperCase());
        for (const n of liveNews) await storage.addNews(n);
        return res.json(await storage.getNews(symbol.toUpperCase()));
      } else {
        const marketNews = await getFinnhubMarketNews(10);
        for (const n of marketNews) await storage.addNews({ symbol: "MARKET", headline: n.headline, summary: n.summary, source: n.source, sentiment: 0, url: n.url });
        const watchlist = await storage.getWatchlist();
        for (const item of watchlist.slice(0, 5)) {
          const liveNews = await getFinnhubNews(item.symbol, 5);
          for (const n of liveNews) await storage.addNews(n);
        }
        return res.json(await storage.getNews());
      }
    } catch {
      res.json(await storage.getNews(symbol?.toUpperCase()));
    }
  });

  app.get("/api/signals", async (req, res) => {
    const symbol = req.query.symbol as string;
    const signals = await storage.getSignals(symbol?.toUpperCase());
    res.json(signals);
  });

  app.post("/api/signals/generate", async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "Symbol required" });

    const upperSymbol = symbol.toUpperCase();
    const settings = await storage.getSettings();

    let quote: StockQuote;
    let history: HistoricalDataPoint[];
    let headlines: string[];

    try {
      quote = await getFinnhubQuote(upperSymbol);
      history = await getFinnhubCandles(upperSymbol, 30);
      headlines = (await getFinnhubNews(upperSymbol, 8)).map(n => n.headline);
    } catch {
      // Finnhub unavailable — try Alpaca position for price, historical DB for candles
      try {
        const positions = await getPositions();
        const pos = positions.find(p => p.symbol === upperSymbol);
        if (pos) {
          quote = { symbol: upperSymbol, price: parseFloat(pos.current_price), change: parseFloat(pos.current_price) - parseFloat(pos.lastday_price), changePercent: +(parseFloat(pos.change_today) * 100).toFixed(2), high: parseFloat(pos.current_price), low: parseFloat(pos.current_price), open: parseFloat(pos.lastday_price), previousClose: parseFloat(pos.lastday_price), volume: 0 };
        } else {
          return res.status(503).json({ error: `No price data for ${upperSymbol} — check Finnhub API key` });
        }
      } catch {
        return res.status(503).json({ error: `No price data for ${upperSymbol} — check API keys` });
      }
      history = (isHistoricalDataAvailable() ? getHistoricalPrices(upperSymbol, 30) : null) || [];
      headlines = [];
    }

    const stats = isHistoricalDataAvailable() ? getStatisticalSummary(upperSymbol) : null;
    let aiResult: { signal: string; confidence: number; reason: string };
    try {
      aiResult = await analyzeStock(upperSymbol, quote, history, headlines, stats);
    } catch (err: any) {
      return res.status(503).json({ error: "AI analysis unavailable — try again shortly", detail: err.message });
    }

    const signal = await storage.addSignal({
      symbol: upperSymbol,
      signal: aiResult.signal,
      confidence: aiResult.confidence,
      price: quote.price,
      reason: aiResult.reason,
    });

    res.json(signal);
  });

  app.delete("/api/signals/all", async (_req, res) => {
    await storage.clearSignals();
    res.json({ ok: true });
  });

  app.delete("/api/signals/:id", async (req, res) => {
    await storage.removeSignal(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/signals/generate-all", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const signals = [];

    for (const item of watchlist) {
      let quote: StockQuote;
      let history: HistoricalDataPoint[];
      let headlines: string[];

      try {
        quote = await getFinnhubQuote(item.symbol);
        history = await getFinnhubCandles(item.symbol, 30);
        headlines = (await getFinnhubNews(item.symbol, 8)).map(n => n.headline);
      } catch {
        // Finnhub unavailable — try Alpaca for price, historical DB for candles
        try {
          const positions = await getPositions();
          const pos = positions.find(p => p.symbol === item.symbol);
          if (pos) {
            quote = { symbol: item.symbol, price: parseFloat(pos.current_price), change: parseFloat(pos.current_price) - parseFloat(pos.lastday_price), changePercent: +(parseFloat(pos.change_today) * 100).toFixed(2), high: parseFloat(pos.current_price), low: parseFloat(pos.current_price), open: parseFloat(pos.lastday_price), previousClose: parseFloat(pos.lastday_price), volume: 0 };
          } else {
            continue; // No data for this symbol — skip
          }
        } catch {
          continue;
        }
        history = (isHistoricalDataAvailable() ? getHistoricalPrices(item.symbol, 30) : null) || [];
        headlines = [];
      }

      const stats = isHistoricalDataAvailable() ? getStatisticalSummary(item.symbol) : null;

      let aiResult: { signal: string; confidence: number; reason: string };
      try {
        aiResult = await analyzeStock(item.symbol, quote, history, headlines, stats);
      } catch {
        continue; // AI unavailable — skip this symbol
      }

      const signal = await storage.addSignal({
        symbol: item.symbol,
        signal: aiResult.signal,
        confidence: aiResult.confidence,
        price: quote.price,
        reason: aiResult.reason,
      });
      signals.push(signal);
    }

    res.json(signals);
  });

  app.get("/api/portfolio/summary", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const signals = await storage.getSignals();
    const buySignals = signals.filter(s => s.signal === "BUY").length;
    const sellSignals = signals.filter(s => s.signal === "SELL").length;
    const holdSignals = signals.filter(s => s.signal === "HOLD").length;

    let totalValue = 0;
    let totalChange = 0;
    let totalChangePercent = 0;
    let cash = 0;
    let buyingPower = 0;
    let longMarketValue = 0;
    let positions: any[] = [];
    let quotes: StockQuote[] = [];

    try {
      const account = await getAccount();
      totalValue = parseFloat(account.equity);
      const lastEquity = parseFloat(account.last_equity);
      totalChange = +(totalValue - lastEquity).toFixed(2);
      totalChangePercent = lastEquity > 0 ? +((totalChange / lastEquity) * 100).toFixed(2) : 0;
      cash = parseFloat(account.cash);
      buyingPower = parseFloat(account.buying_power);
      longMarketValue = parseFloat(account.long_market_value);

      try {
        const alpacaPositions = await getPositions();
        positions = alpacaPositions.map(p => ({
          symbol: p.symbol,
          qty: parseInt(p.qty),
          avgEntry: parseFloat(p.avg_entry_price),
          currentPrice: parseFloat(p.current_price),
          marketValue: parseFloat(p.market_value),
          unrealizedPL: parseFloat(p.unrealized_pl),
          unrealizedPLPercent: parseFloat(p.unrealized_plpc) * 100,
          side: p.side,
        }));

        // Build quotes from Alpaca positions (real prices, stable when market closed)
        quotes = alpacaPositions.map(p => ({
          symbol: p.symbol,
          price: parseFloat(p.current_price),
          change: parseFloat(p.current_price) - parseFloat(p.lastday_price),
          changePercent: +(parseFloat(p.change_today) * 100).toFixed(2),
          high: parseFloat(p.current_price),
          low: parseFloat(p.current_price),
          open: parseFloat(p.lastday_price),
          previousClose: parseFloat(p.lastday_price),
          volume: 0,
        }));
      } catch {}
    } catch (err: any) {
      // Alpaca not connected — return zeros, not fake data
    }

    res.json({
      totalValue: +totalValue.toFixed(2),
      totalChange,
      totalChangePercent,
      cash: +cash.toFixed(2),
      buyingPower: +buyingPower.toFixed(2),
      longMarketValue: +longMarketValue.toFixed(2),
      positions,
      stockCount: watchlist.length,
      buySignals,
      sellSignals,
      holdSignals,
      quotes,
    });
  });

  app.get("/api/alpaca/account", async (_req, res) => {
    try {
      const account = await getAccount();
      res.json(account);
    } catch (error: any) {
      res.status(503).json({ error: error.message || "Alpaca not connected" });
    }
  });

  app.get("/api/alpaca/positions", async (_req, res) => {
    try {
      const positions = await getPositions();
      res.json(positions);
    } catch (error: any) {
      res.status(503).json({ error: error.message || "Alpaca not connected" });
    }
  });

  app.get("/api/alpaca/orders", async (req, res) => {
    try {
      const status = (req.query.status as string) || "all";
      const limit = parseInt(req.query.limit as string) || 50;
      const orders = await getOrders(status, limit);
      res.json(orders);
    } catch (error: any) {
      res.status(503).json({ error: error.message || "Alpaca not connected" });
    }
  });

  app.post("/api/alpaca/orders/preflight", async (req, res) => {
    try {
      const { symbol, qty, side, type, limit_price } = req.body;
      if (!symbol || !qty || !side || !type) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const check = await preflightCheck({ symbol, qty: Number(qty), side, type, limit_price: limit_price ? Number(limit_price) : undefined });
      res.json(check);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/alpaca/orders", async (req, res) => {
    try {
      const { symbol, qty, side, type, time_in_force, limit_price, stop_price } = req.body;
      if (!symbol || !qty || !side || !type || !time_in_force) {
        return res.status(400).json({ error: "Missing required fields: symbol, qty, side, type, time_in_force" });
      }

      const safety = await validateOrder({
        symbol, qty: Number(qty), side, type, limit_price: limit_price ? Number(limit_price) : undefined,
      });

      if (!safety.allowed) {
        return res.status(403).json({ error: safety.reason, warnings: safety.warnings, blocked: true });
      }

      const order = await placeOrder({ symbol, qty: Number(qty), side, type, time_in_force, limit_price: limit_price ? Number(limit_price) : undefined, stop_price: stop_price ? Number(stop_price) : undefined });
      recordOrderPlaced();
      res.json({ ...order, warnings: safety.warnings, isLive: safety.isLive });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to place order" });
    }
  });

  app.delete("/api/alpaca/orders/:id", async (req, res) => {
    try {
      await cancelOrder(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to cancel order" });
    }
  });

  app.delete("/api/alpaca/orders", async (_req, res) => {
    try {
      await cancelAllOrders();
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to cancel orders" });
    }
  });

  app.delete("/api/alpaca/positions/:symbol", async (req, res) => {
    try {
      const order = await closePosition(req.params.symbol.toUpperCase());
      res.json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to close position" });
    }
  });

  app.get("/api/alpaca/status", async (_req, res) => {
    const connected = await isAlpacaConnected();
    res.json({ connected, isLive: isLiveTrading() });
  });

  // --- API Key Management ---
  app.get("/api/api-keys/status", async (_req, res) => {
    res.json(storage.getAllApiKeyStatus());
  });

  app.put("/api/api-keys", async (req, res) => {
    const { key, value } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "Missing 'key' field" });
    }
    if (!isAllowedApiKey(key)) {
      return res.status(400).json({ error: `Invalid key name: ${key}` });
    }
    storage.setApiKey(key, String(value || ""));
    res.json({ ok: true });
  });

  app.post("/api/api-keys/test", async (req, res) => {
    const { service } = req.body;
    try {
      if (service === "alpaca") {
        const account = await getAccount();
        res.json({ connected: true, details: `Account ${account.account_number} (${account.status})` });
      } else if (service === "finnhub") {
        const quote = await getFinnhubQuote("AAPL");
        res.json({ connected: true, details: `AAPL: $${quote.price}` });
      } else if (service === "ollama") {
        const url = storage.getApiKey("OLLAMA_BASE_URL") || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        const base = url.replace(/\/v1\/?$/, "");
        const resp = await fetch(`${base}/api/tags`);
        if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => m.name).join(", ");
        res.json({ connected: true, details: `Models: ${models || "none found"}` });
      } else {
        res.status(400).json({ connected: false, error: "Unknown service" });
      }
    } catch (error: any) {
      res.json({ connected: false, error: error.message || "Connection failed" });
    }
  });

  app.get("/api/autotrade/status", async (_req, res) => {
    const status = getAutoTradeStatus();
    const settings = await storage.getSettings();
    const kellyStats = settings.riskLevel === "medium-controlled" ? getKellyStats() : null;
    res.json({ ...status, newsMonitorRunning: isNewsMonitorRunning(), kellyStats });
  });

  app.get("/api/market-intel", (_req, res) => {
    const buzz = getMarketBuzz();
    if (!buzz) {
      return res.json({
        scannedAt: null,
        totalMentions: 0,
        topTickers: [],
        sourceStatus: { reddit: "skipped", rss: "skipped", sec: "skipped" },
      });
    }
    res.json(buzz);
  });

  // --- AI Thoughts ---
  app.get("/api/ai-thoughts", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json({ thoughts: getThoughts(limit), status: getThinkingStatus() });
  });

  app.post("/api/ai-thoughts/trigger", async (_req, res) => {
    const status = getThinkingStatus();
    if (status.isThinking) {
      return res.json({ ok: false, message: "Already thinking — session in progress" });
    }
    runThinkingSession().catch(() => {});
    res.json({ ok: true, message: "Thinking session triggered" });
  });

  app.get("/api/autotrade/log", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(getAutoTradeLog(limit));
  });

  app.post("/api/autotrade/run", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.autoTrade) {
        return res.status(400).json({ error: "Auto-trade is not enabled. Turn it on in Settings first." });
      }
      await restartAutoTrader();
      res.json({ ok: true, message: "Auto-trade scan triggered" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Signal Refresh Loop (every 2 min, independent of auto-trader) ──
  async function refreshAllSignals() {
    try {
      const wl = await storage.getWatchlist();
      for (const item of wl) {
        try {
          let quote: StockQuote, history: HistoricalDataPoint[], headlines: string[];
          try {
            quote = await getFinnhubQuote(item.symbol);
            history = await getFinnhubCandles(item.symbol, 30);
            headlines = (await getFinnhubNews(item.symbol, 8)).map(n => n.headline);
          } catch {
            // Finnhub unavailable — try Alpaca position price, historical DB candles
            try {
              const positions = await getPositions();
              const pos = positions.find(p => p.symbol === item.symbol);
              if (pos) {
                quote = { symbol: item.symbol, price: parseFloat(pos.current_price), change: parseFloat(pos.current_price) - parseFloat(pos.lastday_price), changePercent: +(parseFloat(pos.change_today) * 100).toFixed(2), high: parseFloat(pos.current_price), low: parseFloat(pos.current_price), open: parseFloat(pos.lastday_price), previousClose: parseFloat(pos.lastday_price), volume: 0 };
              } else {
                continue;
              }
            } catch { continue; }
            history = (isHistoricalDataAvailable() ? getHistoricalPrices(item.symbol, 30) : null) || [];
            headlines = [];
          }
          const stats = isHistoricalDataAvailable() ? getStatisticalSummary(item.symbol) : null;
          const ai = await analyzeStock(item.symbol, quote, history, headlines, stats);
          await storage.addSignal({ symbol: item.symbol, signal: ai.signal as any, confidence: ai.confidence, price: quote.price, reason: ai.reason });
        } catch { /* skip individual failures */ }
      }
    } catch { /* skip entire pass on error */ }
  }
  setInterval(() => { refreshAllSignals().catch(() => {}); }, 2 * 60 * 1000);
  setTimeout(() => { refreshAllSignals().catch(() => {}); }, 15_000); // first run after 15s

  // ── Alpaca → Watchlist Sync (every 30s — add positions not on watchlist) ──
  async function syncPositionsToWatchlist() {
    try {
      const positions = await getPositions();
      const watchlist = await storage.getWatchlist();
      const existing = new Set(watchlist.map(w => w.symbol));
      for (const pos of positions) {
        if (!existing.has(pos.symbol)) {
          await storage.addWatchlistItem({ symbol: pos.symbol, name: pos.symbol });
          console.log(`[WatchlistSync] Auto-added ${pos.symbol} from Alpaca positions`);
        }
      }
    } catch { /* Alpaca not connected yet, skip silently */ }
  }
  setInterval(() => { syncPositionsToWatchlist().catch(() => {}); }, 30_000);
  syncPositionsToWatchlist().catch(() => {});

  const settings = await storage.getSettings();
  if (settings.autoTrade) {
    startAutoTrader().catch(err => console.error("Failed to start auto-trader:", err));
  }
  startNewsMonitor().catch(err => console.error("Failed to start news monitor:", err));
  startMarketIntelMonitor();
  startThinkingLoop();

  return httpServer;
}
