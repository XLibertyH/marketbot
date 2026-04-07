import { storage } from "./storage";
import { getFinnhubQuote } from "./finnhub";
import { analyzeStock } from "./aiAnalysis";
import { addAutoTradeLog } from "./autoTrader";
import { isHistoricalDataAvailable, getTickerUniverse, getHistoricalPrices, getLatestPrice, getStatisticalSummary } from "./historicalData";
import { log } from "./index";
import type { StockQuote } from "@shared/schema";

export interface MomentumHit {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  detectedAt: string;
}

const UNUSUAL_MOVE_THRESHOLD = 5.0; // percent
const SCAN_BATCH_SIZE = 25;
let scanIndex = 0;
const recentHits: MomentumHit[] = [];

// Fallback universe — used only when historical DB is not available
const FALLBACK_UNIVERSE: string[] = [
  "SOFI", "PLTR", "RIOT", "MARA", "UPST", "AFRM", "IONQ", "RKLB",
  "CLOV", "STEM", "JOBY", "ASTS", "RDW", "SPCE", "DNA",
  "GME", "AMC", "BBBY", "HOOD", "WISH", "BB", "NOK",
  "MRNA", "CRSP", "BEAM", "EDIT", "NTLA", "RXRX",
  "SAVA", "BNGO", "GEVO", "NKLA", "WKHS",
  "PLUG", "FSLR", "SEDG", "RUN", "CHPT", "RIVN", "LCID",
  "ENPH", "BLDP", "QS", "GOEV", "PTRA",
  "CRWD", "DDOG", "NET", "SQ", "SHOP", "COIN", "ROKU", "DKNG",
  "SNOW", "BILL", "CFLT", "MDB", "DOCN", "GTLB",
  "ALB", "LAC", "MP", "LTHM", "CLF", "X", "FCX", "VALE",
  "LUNR", "MNTS", "ASTR",
  "MSTR", "HUT", "BITF", "CLSK",
  "SMCI", "ARM", "CART", "BIRK", "KVYO",
  "NU", "TOST", "LMND", "ROOT",
  "NIO", "XPEV", "LI", "BABA", "PDD", "JD",
];

function getUniverse(): string[] {
  if (isHistoricalDataAvailable()) {
    return getTickerUniverse();
  }
  return Array.from(new Set(FALLBACK_UNIVERSE));
}

export function getMomentumUniverse(): string[] {
  return getUniverse();
}

export function getRecentHits(): MomentumHit[] {
  return recentHits.slice(0, 20);
}

export async function runMomentumScan(): Promise<MomentumHit[]> {
  const settings = await storage.getSettings();
  const watchlist = await storage.getWatchlist();
  const watchlistSymbols = new Set(watchlist.map(w => w.symbol.toUpperCase()));

  const universe = getUniverse();

  // Get the next batch of tickers to scan
  const batch: string[] = [];
  for (let i = 0; i < SCAN_BATCH_SIZE; i++) {
    const idx = (scanIndex + i) % universe.length;
    const symbol = universe[idx];
    // Skip symbols already on watchlist — we already analyze those
    if (!watchlistSymbols.has(symbol)) {
      batch.push(symbol);
    }
  }
  scanIndex = (scanIndex + SCAN_BATCH_SIZE) % universe.length;

  if (batch.length === 0) {
    addAutoTradeLog("scan", "Momentum scan: all batch tickers already on watchlist, skipping");
    return [];
  }

  const cycleNum = Math.floor(scanIndex / SCAN_BATCH_SIZE);
  const totalCycles = Math.ceil(universe.length / SCAN_BATCH_SIZE);
  addAutoTradeLog("scan", `Momentum scan: checking ${batch.length} tickers (cycle ${cycleNum}/${totalCycles}, universe: ${universe.length.toLocaleString()}) for unusual moves >±${UNUSUAL_MOVE_THRESHOLD}%`);

  const hits: MomentumHit[] = [];

  for (const symbol of batch) {
    try {
      let quote: StockQuote;
      try {
        quote = await getFinnhubQuote(symbol);
      } catch {
        // Use historical DB latest price if Finnhub unavailable
        const latest = isHistoricalDataAvailable() ? getLatestPrice(symbol) : null;
        if (latest) {
          quote = { symbol, price: latest.close, change: 0, changePercent: 0, high: latest.close, low: latest.close, open: latest.close, previousClose: latest.close, volume: latest.volume };
        } else {
          continue; // No data — skip, don't use fake data
        }
      }

      const absChange = Math.abs(quote.changePercent);
      if (absChange >= UNUSUAL_MOVE_THRESHOLD) {
        const hit: MomentumHit = {
          symbol,
          price: quote.price,
          changePercent: quote.changePercent,
          volume: quote.volume,
          detectedAt: new Date().toISOString(),
        };
        hits.push(hit);
        recentHits.unshift(hit);
        if (recentHits.length > 50) recentHits.length = 50;

        const direction = quote.changePercent > 0 ? "UP" : "DOWN";
        addAutoTradeLog("signal", `MOMENTUM HIT: ${symbol} ${direction} ${absChange.toFixed(1)}% at $${quote.price.toFixed(2)} — adding to watchlist`, symbol, {
          changePercent: quote.changePercent,
          price: quote.price,
          volume: quote.volume,
          type: "momentum_scan",
        });

        // Auto-add to watchlist
        await storage.addWatchlistItem({ symbol, name: `${symbol} (momentum detected)` });

        // Run AI analysis on the hit
        try {
          const history = (isHistoricalDataAvailable() ? getHistoricalPrices(symbol, 30) : null) || [];
          const headlines: string[] = [];
          const stats = isHistoricalDataAvailable() ? getStatisticalSummary(symbol) : null;
          const aiResult = await analyzeStock(symbol, quote, history, headlines, stats);

          await storage.addSignal({
            symbol,
            signal: aiResult.signal,
            confidence: aiResult.confidence,
            price: quote.price,
            reason: `[Momentum ${direction} ${absChange.toFixed(1)}%] ${aiResult.reason}`,
          });

          addAutoTradeLog("signal", `Momentum AI: ${aiResult.signal} at ${(aiResult.confidence * 100).toFixed(0)}% — ${aiResult.reason}`, symbol);
        } catch (err: any) {
          addAutoTradeLog("error", `Momentum AI analysis failed: ${err.message}`, symbol);
        }
      }
    } catch (err: any) {
      // Silently skip symbols that fail — don't spam the log
      log(`[MomentumScanner] Error scanning ${symbol}: ${err.message}`, "momentum");
    }
  }

  if (hits.length === 0) {
    addAutoTradeLog("scan", `Momentum scan complete — no unusual movers found in this batch`);
  } else {
    addAutoTradeLog("scan", `Momentum scan complete — found ${hits.length} unusual mover${hits.length > 1 ? "s" : ""}!`);
  }

  return hits;
}
