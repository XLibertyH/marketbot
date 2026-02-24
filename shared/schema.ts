import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  addedAt: timestamp("added_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tradingSignals = pgTable("trading_signals", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  signal: text("signal").notNull(),
  confidence: real("confidence").notNull(),
  price: real("price").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const newsItems = pgTable("news_items", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  source: text("source").notNull(),
  sentiment: real("sentiment").notNull(),
  url: text("url"),
  publishedAt: timestamp("published_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const botSettings = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  simulationMode: boolean("simulation_mode").default(true).notNull(),
  riskLevel: text("risk_level").default("medium").notNull(),
  maxPositionSize: real("max_position_size").default(1000).notNull(),
  stopLossPercent: real("stop_loss_percent").default(5).notNull(),
  takeProfitPercent: real("take_profit_percent").default(10).notNull(),
  autoTrade: boolean("auto_trade").default(false).notNull(),
  autoTradeInterval: integer("auto_trade_interval").default(5).notNull(),
  autoTradeMinConfidence: real("auto_trade_min_confidence").default(0.75).notNull(),
  autoTradePositionSize: real("auto_trade_position_size").default(500).notNull(),
  tradingPin: text("trading_pin").default("").notNull(),
  maxOrderValue: real("max_order_value").default(5000).notNull(),
  maxDailyLoss: real("max_daily_loss").default(1000).notNull(),
  maxDailyOrders: integer("max_daily_orders").default(20).notNull(),
  requireConfirmation: boolean("require_confirmation").default(true).notNull(),
  allowedSymbols: text("allowed_symbols").default("").notNull(),
});

export const insertWatchlistSchema = createInsertSchema(watchlistItems).omit({ id: true, addedAt: true });
export const insertSignalSchema = createInsertSchema(tradingSignals).omit({ id: true, createdAt: true });
export const insertNewsSchema = createInsertSchema(newsItems).omit({ id: true, publishedAt: true });
export const insertBotSettingsSchema = createInsertSchema(botSettings).omit({ id: true });

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type TradingSignal = typeof tradingSignals.$inferSelect;
export type InsertTradingSignal = z.infer<typeof insertSignalSchema>;
export type NewsItem = typeof newsItems.$inferSelect;
export type InsertNewsItem = z.infer<typeof insertNewsSchema>;
export type BotSettings = typeof botSettings.$inferSelect;
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  volume: number;
}

export interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
