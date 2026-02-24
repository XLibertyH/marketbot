# TradeBot AI - Stock Trading Dashboard

## Overview
AI-powered stock trading bot with real-time dashboard. Supports simulation mode with mock data for testing, live market data via Finnhub API, and paper trading via Alpaca.

## Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Recharts
- **Backend**: Express.js + TypeScript
- **AI**: OpenAI via Replit AI Integrations (no separate API key needed)
- **Market Data**: Finnhub API (real-time quotes, historical candles, company news)
- **Paper Trading**: Alpaca API (account info, positions, orders, trade execution)
- **Storage**: In-memory (MemStorage pattern)

## Key Features
- Dashboard with portfolio overview, price charts, live quotes
- Watchlist management (add/remove stocks)
- AI-powered trading signals (BUY/SELL/HOLD with confidence scores)
- News sentiment analysis (real news via Finnhub when live)
- Paper trading via Alpaca (place orders, view positions, order history)
- Bot settings with risk management configuration
- Dual mode: Simulation (mock data) or Live (Finnhub real market data)

## Project Structure
```
shared/schema.ts       - Data types and interfaces
server/routes.ts       - API routes (simulation/live mode switching)
server/storage.ts      - Storage interface (MemStorage)
server/mockData.ts     - Mock data generators for simulation
server/finnhub.ts      - Finnhub API client (quotes, candles, news)
server/alpaca.ts       - Alpaca paper trading client (account, orders, positions)
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

## Environment Variables
- `ALPACA_API_KEY` - Alpaca paper trading API key
- `ALPACA_SECRET_KEY` - Alpaca paper trading secret key
- `FINNHUB_API_KEY` - Required for live market data
- `SESSION_SECRET` - Session management
- OpenAI credentials auto-provided by Replit AI Integrations

## Running
- `npm run dev` starts both frontend and backend on port 5000
- Simulation mode is ON by default - no API keys needed to test
- Toggle simulation off in Settings page to use real Finnhub market data
- Paper trading works independently of simulation mode (always uses real Alpaca API)
- All routes gracefully fall back to mock data if Finnhub calls fail
