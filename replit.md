# TradeBot AI - Stock Trading Dashboard

## Overview
AI-powered stock trading bot with real-time dashboard. Runs fully local using deepseek-r1:70b via Ollama. Supports simulation mode with mock data for testing, live market data via Finnhub API, and paper trading via Alpaca. Includes auto-trading engine with momentum scanning and AI-driven stock discovery.

## Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Recharts
- **Backend**: Express.js + TypeScript
- **AI**: Local deepseek-r1:70b via Ollama (OpenAI-compatible /v1 endpoint)
- **Market Data**: Finnhub API (real-time quotes, historical candles, company news)
- **Paper Trading**: Alpaca API (account info, positions, orders, trade execution)
- **Storage**: In-memory (MemStorage pattern)

## Key Features
- Dashboard with portfolio overview, price charts, live quotes, auto-trade activity log
- Watchlist management (add/remove stocks)
- AI-powered trading signals (BUY/SELL/HOLD with confidence scores)
- News sentiment analysis (real news via Finnhub when live, mock news in simulation)
- Paper trading via Alpaca (place orders, view positions, order history)
- **Auto-trading**: AI scans watchlist on a timer, places trades when confidence exceeds threshold
- **Breaking news monitor**: Polls for new headlines every 30s, triggers immediate AI analysis
- **Momentum scanner**: Rotates through ~100 tickers scanning for unusual movers (>5% daily change)
- **Diverse stock discovery**: AI suggests small/mid-cap stocks with catalysts, not just mega-caps
- Bot settings with risk management configuration
- Dual mode: Simulation (mock data) or Live (Finnhub real market data)

## Auto-Trading Engine (`server/autoTrader.ts`)
- Runs on configurable interval (default 5 minutes)
- Scans all watchlist stocks, generates AI signals for each
- Places BUY orders when signal is BUY and confidence >= threshold (default 75%)
- Places SELL orders when signal is SELL and a position exists
- Skips BUY if already holding a position in that stock
- Respects all safety guards (max order value, daily loss limit, daily order limit, allowed symbols)
- **Momentum Scanner**: Scans batches of tickers for unusual price moves, auto-adds big movers to watchlist
- **AI Stock Discovery**: Asks AI to suggest 2-5 small/mid-cap stocks with catalysts
- Activity log stored in memory (last 100 entries), visible on Dashboard

## News Monitor (`server/newsMonitor.ts`)
- **General market news**: Polls for broad market headlines every 30 seconds
- **Company-specific news**: Polls for each watchlist stock
- Works in both simulation mode (mock news) and live mode (Finnhub API)
- When new headlines detected: triggers immediate AI analysis and potential auto-trades
- AI discovers relevant stocks to add to watchlist based on news context

## Project Structure
```
shared/schema.ts         - Data types and interfaces
server/routes.ts         - API routes (simulation/live mode switching)
server/storage.ts        - Storage interface (MemStorage)
server/mockData.ts       - Mock data generators for simulation
server/finnhub.ts        - Finnhub API client (quotes, candles, news)
server/alpaca.ts         - Alpaca trading client (account, orders, positions)
server/tradingGuards.ts  - Server-side order validation and safety checks
server/autoTrader.ts     - Auto-trading engine (signal scan + order execution)
server/newsMonitor.ts    - Breaking news monitor (polls for news, triggers AI)
server/momentumScanner.ts - Rotates through ticker universe scanning for big movers
server/aiAnalysis.ts     - Local AI stock analysis via Ollama
client/src/App.tsx       - Main app with sidebar navigation
client/src/pages/        - Dashboard, Trading, Watchlist, Signals, News, Settings
```

## Environment Variables
- `ALPACA_API_KEY` - Alpaca trading API key
- `ALPACA_SECRET_KEY` - Alpaca trading secret key
- `ALPACA_BASE_URL` - Alpaca API base URL (default: paper-api.alpaca.markets)
- `FINNHUB_API_KEY` - Required for live market data
- `OLLAMA_BASE_URL` - Ollama API endpoint (default: http://localhost:11434/v1)
- `OLLAMA_MODEL` - Model name (default: deepseek-r1:70b)

## Running
- `npm run dev` starts both frontend and backend on port 3333
- Simulation mode is ON by default — no API keys needed to test
- Ollama must be running with deepseek-r1:70b loaded
- Toggle simulation off in Settings page to use real Finnhub market data
- Paper trading works independently of simulation mode (always uses real Alpaca API)
