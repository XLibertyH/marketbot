import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getMockQuote, getMockHistoricalData, getMockNews, getMockSignal } from "./mockData";
import { getFinnhubQuote, getFinnhubCandles, getFinnhubNews } from "./finnhub";
import { getAccount, getPositions, getOrders, placeOrder, cancelOrder, cancelAllOrders, closePosition, isAlpacaConnected, isLiveTrading } from "./alpaca";
import { validateOrder, recordOrderPlaced, preflightCheck } from "./tradingGuards";
import { analyzeStock } from "./aiAnalysis";
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

  app.get("/api/quotes", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const settings = await storage.getSettings();

    if (!settings.simulationMode) {
      try {
        const quotes: StockQuote[] = [];
        for (const item of watchlist) {
          try {
            const q = await getFinnhubQuote(item.symbol);
            quotes.push(q);
          } catch {
            quotes.push(getMockQuote(item.symbol));
          }
        }
        return res.json(quotes);
      } catch {
        // fall through to mock
      }
    }

    const quotes = watchlist.map(item => getMockQuote(item.symbol));
    res.json(quotes);
  });

  app.get("/api/quote/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const settings = await storage.getSettings();

    if (!settings.simulationMode) {
      try {
        const quote = await getFinnhubQuote(symbol);
        return res.json(quote);
      } catch {
        // fall through to mock
      }
    }

    res.json(getMockQuote(symbol));
  });

  app.get("/api/history/:symbol", async (req, res) => {
    const days = parseInt(req.query.days as string) || 90;
    const symbol = req.params.symbol.toUpperCase();
    const settings = await storage.getSettings();

    if (!settings.simulationMode) {
      try {
        const data = await getFinnhubCandles(symbol, days);
        return res.json(data);
      } catch {
        // fall through to mock
      }
    }

    res.json(getMockHistoricalData(symbol, days));
  });

  app.get("/api/news", async (req, res) => {
    const symbol = req.query.symbol as string;
    const settings = await storage.getSettings();

    if (!settings.simulationMode) {
      try {
        if (symbol) {
          const liveNews = await getFinnhubNews(symbol.toUpperCase());
          for (const n of liveNews) {
            await storage.addNews(n);
          }
        } else {
          const watchlist = await storage.getWatchlist();
          for (const item of watchlist.slice(0, 3)) {
            const liveNews = await getFinnhubNews(item.symbol, 3);
            for (const n of liveNews) {
              await storage.addNews(n);
            }
          }
        }
        const news = await storage.getNews(symbol?.toUpperCase());
        return res.json(news);
      } catch {
        // fall through to mock
      }
    }

    if (symbol) {
      const mockNews = getMockNews(symbol.toUpperCase());
      for (const n of mockNews) {
        await storage.addNews(n);
      }
    }
    const news = await storage.getNews(symbol?.toUpperCase());
    if (news.length === 0 && !symbol) {
      const watchlist = await storage.getWatchlist();
      for (const item of watchlist.slice(0, 3)) {
        const mockNews = getMockNews(item.symbol, 3);
        for (const n of mockNews) {
          await storage.addNews(n);
        }
      }
      const allNews = await storage.getNews();
      return res.json(allNews);
    }
    res.json(news);
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
      if (!settings.simulationMode) {
        quote = await getFinnhubQuote(upperSymbol);
        history = await getFinnhubCandles(upperSymbol, 30);
        const liveNews = await getFinnhubNews(upperSymbol, 3);
        headlines = liveNews.map(n => n.headline);
      } else {
        quote = getMockQuote(upperSymbol);
        history = getMockHistoricalData(upperSymbol, 30);
        headlines = getMockNews(upperSymbol, 3).map(n => n.headline);
      }
    } catch {
      quote = getMockQuote(upperSymbol);
      history = getMockHistoricalData(upperSymbol, 30);
      headlines = getMockNews(upperSymbol, 3).map(n => n.headline);
    }

    let signalData: { signal: string; confidence: number; reason: string; price: number };

    try {
      const aiResult = await analyzeStock(upperSymbol, quote, history, headlines);
      signalData = { ...aiResult, price: quote.price };
    } catch {
      signalData = { ...getMockSignal(upperSymbol, quote.price), price: quote.price };
    }

    const signal = await storage.addSignal({
      symbol: upperSymbol,
      signal: signalData.signal,
      confidence: signalData.confidence,
      price: signalData.price,
      reason: signalData.reason,
    });

    res.json(signal);
  });

  app.post("/api/signals/generate-all", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const settings = await storage.getSettings();
    const signals = [];

    for (const item of watchlist) {
      let quote: StockQuote;
      let history: HistoricalDataPoint[];
      let headlines: string[];

      try {
        if (!settings.simulationMode) {
          quote = await getFinnhubQuote(item.symbol);
          history = await getFinnhubCandles(item.symbol, 30);
          const liveNews = await getFinnhubNews(item.symbol, 3);
          headlines = liveNews.map(n => n.headline);
        } else {
          quote = getMockQuote(item.symbol);
          history = getMockHistoricalData(item.symbol, 30);
          headlines = getMockNews(item.symbol, 3).map(n => n.headline);
        }
      } catch {
        quote = getMockQuote(item.symbol);
        history = getMockHistoricalData(item.symbol, 30);
        headlines = getMockNews(item.symbol, 3).map(n => n.headline);
      }

      let signalData: { signal: string; confidence: number; reason: string; price: number };
      try {
        const aiResult = await analyzeStock(item.symbol, quote, history, headlines);
        signalData = { ...aiResult, price: quote.price };
      } catch {
        signalData = { ...getMockSignal(item.symbol, quote.price), price: quote.price };
      }

      const signal = await storage.addSignal({
        symbol: item.symbol,
        signal: signalData.signal,
        confidence: signalData.confidence,
        price: signalData.price,
        reason: signalData.reason,
      });
      signals.push(signal);
    }

    res.json(signals);
  });

  app.get("/api/portfolio/summary", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const settings = await storage.getSettings();

    let quotes: StockQuote[];
    if (!settings.simulationMode) {
      quotes = [];
      for (const item of watchlist) {
        try {
          quotes.push(await getFinnhubQuote(item.symbol));
        } catch {
          quotes.push(getMockQuote(item.symbol));
        }
      }
    } else {
      quotes = watchlist.map(item => getMockQuote(item.symbol));
    }

    const signals = await storage.getSignals();

    const totalValue = quotes.reduce((sum, q) => sum + q.price * 10, 0);
    const totalChange = quotes.reduce((sum, q) => sum + q.change * 10, 0);
    const buySignals = signals.filter(s => s.signal === "BUY").length;
    const sellSignals = signals.filter(s => s.signal === "SELL").length;
    const holdSignals = signals.filter(s => s.signal === "HOLD").length;

    res.json({
      totalValue: +totalValue.toFixed(2),
      totalChange: +totalChange.toFixed(2),
      totalChangePercent: +((totalChange / (totalValue - totalChange)) * 100).toFixed(2),
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
      const { symbol, qty, side, type, time_in_force, limit_price, stop_price, pin } = req.body;
      if (!symbol || !qty || !side || !type || !time_in_force) {
        return res.status(400).json({ error: "Missing required fields: symbol, qty, side, type, time_in_force" });
      }

      const safety = await validateOrder({
        symbol, qty: Number(qty), side, type, limit_price: limit_price ? Number(limit_price) : undefined, pin,
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

  return httpServer;
}
