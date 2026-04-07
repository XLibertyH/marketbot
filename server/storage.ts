import {
  type WatchlistItem, type InsertWatchlistItem,
  type TradingSignal, type InsertTradingSignal,
  type NewsItem, type InsertNewsItem,
  type BotSettings, type InsertBotSettings,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ENV_FILE = join(process.cwd(), ".env");

function loadEnvFile(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(ENV_FILE)) return map;
  try {
    const lines = readFileSync(ENV_FILE, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key) map.set(key, val);
    }
  } catch { /* ignore read errors */ }
  return map;
}

function saveEnvFile(keys: Map<string, string>): void {
  try {
    const lines = ["# TradeBot AI — persisted API keys (auto-generated, do not commit)"];
    for (const [k, v] of keys.entries()) {
      lines.push(`${k}=${v}`);
    }
    writeFileSync(ENV_FILE, lines.join("\n") + "\n", "utf-8");
  } catch { /* ignore write errors */ }
}

const ALLOWED_API_KEYS = [
  "FINNHUB_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_SECRET_KEY",
  "ALPACA_BASE_URL",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_FAST_MODEL",
  "OLLAMA_SIGNAL_MODEL",
] as const;

export type ApiKeyName = typeof ALLOWED_API_KEYS[number];

export function isAllowedApiKey(key: string): key is ApiKeyName {
  return (ALLOWED_API_KEYS as readonly string[]).includes(key);
}

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
  getApiKey(name: ApiKeyName): string | undefined;
  setApiKey(name: ApiKeyName, value: string): void;
  getAllApiKeyStatus(): Record<string, boolean | string | null>;
}

export class MemStorage implements IStorage {
  private watchlist: Map<number, WatchlistItem> = new Map();
  private signals: Map<number, TradingSignal> = new Map();
  private news: Map<number, NewsItem> = new Map();
  private settings: BotSettings;
  private apiKeys: Map<string, string> = new Map();
  private nextId = 1;

  constructor() {
    // Load persisted keys from .env file on startup
    const saved = loadEnvFile();
    for (const [k, v] of saved.entries()) {
      if (isAllowedApiKey(k) && v) this.apiKeys.set(k, v);
    }
    if (saved.size > 0) {
      console.log(`[Storage] Loaded ${saved.size} persisted API key(s) from .env`);
    }

    this.settings = {
      id: 1,
      simulationMode: false,
      riskLevel: "medium",
      maxPositionSize: 1000,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      autoTrade: false,
      autoTradeInterval: 5,
      autoTradeMinConfidence: 0.75,
      autoTradePositionSize: 500,
      tradingPin: "",
      maxOrderValue: 5000,
      maxDailyLoss: 1000,
      maxDailyOrders: 20,
      requireConfirmation: true,
      allowedSymbols: "",
      maxEquityExposure: 0,
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

  async removeSignal(id: number): Promise<void> {
    this.signals.delete(id);
  }

  async clearSignals(): Promise<void> {
    this.signals.clear();
  }

  async getNews(symbol?: string): Promise<NewsItem[]> {
    const all = Array.from(this.news.values());
    if (symbol) return all.filter(n => n.symbol === symbol);
    return all.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  async addNews(item: InsertNewsItem): Promise<NewsItem> {
    const id = this.nextId++;
    const newsItem: NewsItem = { id, ...item, url: item.url ?? null, publishedAt: (item as any).publishedAt instanceof Date ? (item as any).publishedAt : new Date() };
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

  getApiKey(name: ApiKeyName): string | undefined {
    return this.apiKeys.get(name) || undefined;
  }

  setApiKey(name: ApiKeyName, value: string): void {
    if (value.trim()) {
      this.apiKeys.set(name, value.trim());
    } else {
      this.apiKeys.delete(name);
    }
    // Persist to .env so keys survive server restarts
    saveEnvFile(this.apiKeys);
  }

  getAllApiKeyStatus(): Record<string, boolean | string | null> {
    return {
      finnhub: !!(this.apiKeys.get("FINNHUB_API_KEY") || process.env.FINNHUB_API_KEY),
      alpacaKey: !!(this.apiKeys.get("ALPACA_API_KEY") || process.env.ALPACA_API_KEY),
      alpacaSecret: !!(this.apiKeys.get("ALPACA_SECRET_KEY") || process.env.ALPACA_SECRET_KEY),
      ollamaUrl: this.apiKeys.get("OLLAMA_BASE_URL") || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      ollamaModel: this.apiKeys.get("OLLAMA_MODEL") || process.env.OLLAMA_MODEL || "deepseek-r1:70b",
      ollamaFastModel: this.apiKeys.get("OLLAMA_FAST_MODEL") || process.env.OLLAMA_FAST_MODEL || "deepseek-r1:8b",
      ollamaSignalModel: this.apiKeys.get("OLLAMA_SIGNAL_MODEL") || process.env.OLLAMA_SIGNAL_MODEL || "deepseek-r1:14b",
    };
  }
}

export const storage = new MemStorage();
