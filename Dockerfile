# --- Build stage ---
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# --- Production stage ---
FROM node:22-slim AS production
WORKDIR /app

# better-sqlite3 needs native compilation tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm rebuild better-sqlite3

# Copy built assets
COPY --from=builder /app/dist ./dist

# Data files: the CJS bundle resolves __dirname to dist/,
# so it looks for dist/data/market_events.json and dist/data/prices.sqlite
COPY server/data/market_events.json ./dist/data/market_events.json

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0
EXPOSE 3333

# The SQLite prices.sqlite is volume-mounted into dist/data/ (see docker-compose.yml)
CMD ["node", "dist/index.cjs"]
