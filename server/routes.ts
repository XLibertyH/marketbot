import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getMockQuote, getMockHistoricalData, getMockNews, getMockSignal } from "./mockData";
import { analyzeStock } from "./aiAnalysis";
import { insertWatchlistSchema, insertBotSettingsSchema } from "@shared/schema";

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
    const quotes = watchlist.map(item => getMockQuote(item.symbol));
    res.json(quotes);
  });

  app.get("/api/quote/:symbol", async (req, res) => {
    const quote = getMockQuote(req.params.symbol.toUpperCase());
    res.json(quote);
  });

  app.get("/api/history/:symbol", async (req, res) => {
    const days = parseInt(req.query.days as string) || 90;
    const data = getMockHistoricalData(req.params.symbol.toUpperCase(), days);
    res.json(data);
  });

  app.get("/api/news", async (req, res) => {
    const symbol = req.query.symbol as string;
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
    const quote = getMockQuote(upperSymbol);
    const history = getMockHistoricalData(upperSymbol, 30);
    const settings = await storage.getSettings();

    let signalData;

    if (settings.simulationMode) {
      const newsItems = getMockNews(upperSymbol, 3);
      const headlines = newsItems.map(n => n.headline);

      try {
        signalData = await analyzeStock(upperSymbol, quote, history, headlines);
        signalData.price = quote.price;
      } catch {
        const mock = getMockSignal(upperSymbol, quote.price);
        signalData = mock;
      }
    } else {
      const mock = getMockSignal(upperSymbol, quote.price);
      signalData = mock;
    }

    const signal = await storage.addSignal({
      symbol: upperSymbol,
      signal: signalData.signal,
      confidence: signalData.confidence,
      price: signalData.price || quote.price,
      reason: signalData.reason,
    });

    res.json(signal);
  });

  app.post("/api/signals/generate-all", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const signals = [];

    for (const item of watchlist) {
      const quote = getMockQuote(item.symbol);
      const history = getMockHistoricalData(item.symbol, 30);
      const settings = await storage.getSettings();

      let signalData;
      try {
        if (settings.simulationMode) {
          const newsItems = getMockNews(item.symbol, 3);
          const headlines = newsItems.map(n => n.headline);
          signalData = await analyzeStock(item.symbol, quote, history, headlines);
          signalData.price = quote.price;
        } else {
          signalData = getMockSignal(item.symbol, quote.price);
        }
      } catch {
        signalData = getMockSignal(item.symbol, quote.price);
      }

      const signal = await storage.addSignal({
        symbol: item.symbol,
        signal: signalData.signal,
        confidence: signalData.confidence,
        price: signalData.price || quote.price,
        reason: signalData.reason,
      });
      signals.push(signal);
    }

    res.json(signals);
  });

  app.get("/api/portfolio/summary", async (_req, res) => {
    const watchlist = await storage.getWatchlist();
    const quotes = watchlist.map(item => getMockQuote(item.symbol));
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

  return httpServer;
}
