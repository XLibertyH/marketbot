# TradeBot AI - Stock Trading Dashboard

## Overview
AI-powered stock trading bot with real-time dashboard. Supports simulation mode with mock data for testing, live market data via Finnhub API, and paper trading via Alpaca. Includes auto-trading engine that executes trades based on AI signal analysis.

## Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Recharts
- **Backend**: Express.js + TypeScript
- **AI**: OpenAI via Replit AI Integrations (no separate API key needed)
- **Market Data**: Finnhub API (real-time quotes, historical candles, company news)
- **Paper Trading**: Alpaca API (account info, positions, orders, trade execution)
- **Storage**: In-memory (MemStorage pattern)

## Key Features
- Dashboard with portfolio overview, price charts, live quotes, auto-trade activity log
- Watchlist management (add/remove stocks)
- AI-powered trading signals (BUY/SELL/HOLD with confidence scores)
- News sentiment analysis (real news via Finnhub when live)
- Paper trading via Alpaca (place orders, view positions, order history)
- **Auto-trading**: AI scans watchlist on a timer, places trades when confidence exceeds threshold
- Bot settings with risk management configuration
- Dual mode: Simulation (mock data) or Live (Finnhub real market data)

## Auto-Trading Engine (`server/autoTrader.ts`)
- Runs on configurable interval (default 5 minutes)
- Scans all watchlist stocks, generates AI signals for each
- Places BUY orders when signal is BUY and confidence >= threshold (default 75%)
- Places SELL orders when signal is SELL and a position exists
- Skips BUY if already holding a position in that stock
- Respects all safety guards (max order value, daily loss limit, daily order limit, allowed symbols)
- Calculates share quantity from position size setting and current price
- Activity log stored in memory (last 100 entries), visible on Dashboard
- Settings: `autoTradeInterval` (minutes), `autoTradeMinConfidence` (0-1), `autoTradePositionSize` ($)
- Starts/stops automatically when autoTrade setting is toggled
- Also starts on server boot if autoTrade was enabled

## Trading Safety Features
- **Max Order Value**: Server-enforced cap on individual order value (default $5,000)
- **Daily Loss Limit**: Blocks new orders when daily losses exceed threshold (default $1,000)
- **Daily Order Limit**: Maximum orders per day (default 20)
- **Allowed Symbols List**: Restrict trading to specific tickers only
- **Order Confirmation**: Two-step review with preflight checks before submission
- **Large Position Warnings**: Alerts when order exceeds 25% of equity
- **Buying Power Check**: Validates sufficient funds before placing buy orders
- **Live Mode Banner**: Prominent warnings throughout UI when using real money
- Alpaca base URL configurable via ALPACA_BASE_URL env var (defaults to paper trading)

## Project Structure
```
shared/schema.ts       - Data types and interfaces
server/routes.ts       - API routes (simulation/live mode switching)
server/storage.ts      - Storage interface (MemStorage)
server/mockData.ts     - Mock data generators for simulation
server/finnhub.ts      - Finnhub API client (quotes, candles, news)
server/alpaca.ts       - Alpaca trading client (account, orders, positions)
server/tradingGuards.ts - Server-side order validation and safety checks
server/autoTrader.ts   - Auto-trading engine (signal scan + order execution)
server/aiAnalysis.ts   - OpenAI-powered stock analysis
client/src/App.tsx     - Main app with sidebar navigation
client/src/pages/      - Dashboard, Trading, Watchlist, Signals, News, Settings
```

## API Endpoints
- GET /api/settings, PATCH /api/settings
- GET /api/watchlist, POST /api/watchlist, DELETE /api/watchlist/:id
- GET /api/quotes, GET /api/quote/:symbol
- GET /api/history/:symbol?days=90
- GET /api/news?symbol=X
- GET /api/signals?symbol=X
- POST /api/signals/generate (single), POST /api/signals/generate-all
- GET /api/portfolio/summary
- GET /api/alpaca/status
- GET /api/alpaca/account
- GET /api/alpaca/positions, DELETE /api/alpaca/positions/:symbol
- GET /api/alpaca/orders, POST /api/alpaca/orders, DELETE /api/alpaca/orders/:id
- POST /api/alpaca/orders/preflight (safety check before placing order)
- GET /api/autotrade/status (running state, last run time)
- GET /api/autotrade/log (activity log entries)
- POST /api/autotrade/run (trigger immediate scan)

## Environment Variables
- `ALPACA_API_KEY` - Alpaca trading API key
- `ALPACA_SECRET_KEY` - Alpaca trading secret key
- `ALPACA_BASE_URL` - Alpaca API base URL (default: paper-api.alpaca.markets)
- `FINNHUB_API_KEY` - Required for live market data
- `SESSION_SECRET` - Session management
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` - For local AI (optional)
- OpenAI credentials auto-provided by Replit AI Integrations

## Running
- `npm run dev` starts both frontend and backend on port 5000
- Simulation mode is ON by default - no API keys needed to test
- Toggle simulation off in Settings page to use real Finnhub market data
- Paper trading works independently of simulation mode (always uses real Alpaca API)
- All routes gracefully fall back to mock data if Finnhub calls fail
- To switch to live trading: set ALPACA_BASE_URL=https://api.alpaca.markets and use live API keys
