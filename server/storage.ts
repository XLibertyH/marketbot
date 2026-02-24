import {
  type WatchlistItem, type InsertWatchlistItem,
  type TradingSignal, type InsertTradingSignal,
  type NewsItem, type InsertNewsItem,
  type BotSettings, type InsertBotSettings,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getWatchlist(): Promise<WatchlistItem[]>;
  addWatchlistItem(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeWatchlistItem(id: number): Promise<void>;
  getSignals(symbol?: string): Promise<TradingSignal[]>;
  addSignal(signal: InsertTradingSignal): Promise<TradingSignal>;
  getNews(symbol?: string): Promise<NewsItem[]>;
  addNews(item: InsertNewsItem): Promise<NewsItem>;
  getSettings(): Promise<BotSettings>;
  updateSettings(settings: Partial<InsertBotSettings>): Promise<BotSettings>;
}

export class MemStorage implements IStorage {
  private watchlist: Map<number, WatchlistItem> = new Map();
  private signals: Map<number, TradingSignal> = new Map();
  private news: Map<number, NewsItem> = new Map();
  private settings: BotSettings;
  private nextId = 1;

  constructor() {
    this.settings = {
      id: 1,
      simulationMode: true,
      riskLevel: "medium",
      maxPositionSize: 1000,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      autoTrade: false,
    };

    const defaultStocks = [
      { symbol: "AAPL", name: "Apple Inc." },
      { symbol: "GOOGL", name: "Alphabet Inc." },
      { symbol: "MSFT", name: "Microsoft Corporation" },
      { symbol: "TSLA", name: "Tesla Inc." },
      { symbol: "AMZN", name: "Amazon.com Inc." },
    ];
    defaultStocks.forEach(s => {
      const id = this.nextId++;
      this.watchlist.set(id, { id, ...s, addedAt: new Date() });
    });
  }

  async getWatchlist(): Promise<WatchlistItem[]> {
    return Array.from(this.watchlist.values());
  }

  async addWatchlistItem(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const id = this.nextId++;
    const watchlistItem: WatchlistItem = { id, ...item, addedAt: new Date() };
    this.watchlist.set(id, watchlistItem);
    return watchlistItem;
  }

  async removeWatchlistItem(id: number): Promise<void> {
    this.watchlist.delete(id);
  }

  async getSignals(symbol?: string): Promise<TradingSignal[]> {
    const all = Array.from(this.signals.values());
    if (symbol) return all.filter(s => s.symbol === symbol);
    return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async addSignal(signal: InsertTradingSignal): Promise<TradingSignal> {
    const id = this.nextId++;
    const tradingSignal: TradingSignal = { id, ...signal, createdAt: new Date() };
    this.signals.set(id, tradingSignal);
    return tradingSignal;
  }

  async getNews(symbol?: string): Promise<NewsItem[]> {
    const all = Array.from(this.news.values());
    if (symbol) return all.filter(n => n.symbol === symbol);
    return all.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  async addNews(item: InsertNewsItem): Promise<NewsItem> {
    const id = this.nextId++;
    const newsItem: NewsItem = { id, ...item, publishedAt: new Date() };
    this.news.set(id, newsItem);
    return newsItem;
  }

  async getSettings(): Promise<BotSettings> {
    return this.settings;
  }

  async updateSettings(settings: Partial<InsertBotSettings>): Promise<BotSettings> {
    this.settings = { ...this.settings, ...settings };
    return this.settings;
  }
}

export const storage = new MemStorage();
