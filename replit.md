# TradeBot AI - Stock Trading Dashboard

## Overview
AI-powered stock trading bot with real-time dashboard. Supports simulation mode with mock data for testing without real API keys.

## Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Recharts
- **Backend**: Express.js + TypeScript
- **AI**: OpenAI via Replit AI Integrations (no separate API key needed)
- **Storage**: In-memory (MemStorage pattern)

## Key Features
- Dashboard with portfolio overview, price charts, live quotes
- Watchlist management (add/remove stocks)
- AI-powered trading signals (BUY/SELL/HOLD with confidence scores)
- News sentiment analysis
- Bot settings with risk management configuration
- Simulation mode with realistic mock market data

## Project Structure
```
shared/schema.ts       - Data types and interfaces
server/routes.ts       - API routes
server/storage.ts      - Storage interface (MemStorage)
server/mockData.ts     - Mock data generators for simulation
server/aiAnalysis.ts   - OpenAI-powered stock analysis
client/src/App.tsx     - Main app with sidebar navigation
client/src/pages/      - Dashboard, Watchlist, Signals, News, Settings
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

## Running
- `npm run dev` starts both frontend and backend on port 5000
- Simulation mode is ON by default - no API keys needed to test
