import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useState } from "react";
import { Newspaper, TrendingUp, TrendingDown, Minus, Globe, ExternalLink, Flame, Plus } from "lucide-react";
import type { NewsItem, WatchlistItem } from "@shared/schema";

// ── Types ──────────────────────────────────────────

interface MarketBuzzItem {
  ticker: string;
  mentionCount: number;
  sources: string[];
  headlines: string[];
  sentiment: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface MarketIntelData {
  scannedAt: string | null;
  totalMentions: number;
  topTickers: MarketBuzzItem[];
  sourceStatus: { reddit: string; rss: string; sec: string };
}

// ── Sub-components ─────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: number }) {
  if (sentiment > 0.2) {
    return (
      <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10">
        <TrendingUp className="mr-1 h-3 w-3" />
        Positive ({(sentiment * 100).toFixed(0)}%)
      </Badge>
    );
  }
  if (sentiment < -0.2) {
    return (
      <Badge variant="outline" className="text-red-500 border-red-500/30 bg-red-500/10">
        <TrendingDown className="mr-1 h-3 w-3" />
        Negative ({(sentiment * 100).toFixed(0)}%)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10">
      <Minus className="mr-1 h-3 w-3" />
      Neutral ({(sentiment * 100).toFixed(0)}%)
    </Badge>
  );
}

function SourceDot({ status }: { status: string }) {
  const color = status === "ok" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function MarketBuzzPanel({ watchlistSymbols }: { watchlistSymbols: string[] }) {
  const { data: intel, isLoading } = useQuery<MarketIntelData>({
    queryKey: ["/api/market-intel"],
    refetchInterval: 2 * 60 * 1000,
  });

  const addToWatchlist = useMutation({
    mutationFn: async (ticker: string) => {
      await apiRequest("POST", "/api/watchlist", { symbol: ticker, name: ticker });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-4 w-4 text-orange-500" />
            Market Buzz
          </CardTitle>
          {intel?.scannedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(intel.scannedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <CardDescription className="flex items-center gap-3 mt-1">
          <span>Trending across Reddit, news, &amp; SEC filings</span>
          {intel && (
            <span className="flex items-center gap-1.5 text-xs">
              <SourceDot status={intel.sourceStatus.reddit} /> Reddit
              <SourceDot status={intel.sourceStatus.rss} /> News
              <SourceDot status={intel.sourceStatus.sec} /> SEC
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : !intel || intel.topTickers.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Flame className="h-8 w-8 mx-auto mb-2 opacity-20" />
            No buzz detected yet — scan runs every 5 minutes
          </div>
        ) : (
          <div className="space-y-2">
            {intel.topTickers.slice(0, 10).map(item => {
              const alreadyWatching = watchlistSymbols.includes(item.ticker);
              return (
                <div
                  key={item.ticker}
                  className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex flex-col items-center gap-1 min-w-[52px]">
                    <Badge className="bg-primary/15 text-primary hover:bg-primary/20 border-0 font-bold text-xs px-2">
                      {item.ticker}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{item.mentionCount}×</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap mb-0.5">
                      {item.sources.includes("reddit") && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-orange-500/30 text-orange-600">Reddit</Badge>
                      )}
                      {item.sources.includes("rss") && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500/30 text-blue-600">News</Badge>
                      )}
                      {item.sources.includes("sec") && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-500/30 text-purple-600">SEC</Badge>
                      )}
                    </div>
                    {item.headlines[0] && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{item.headlines[0]}</p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shrink-0"
                    disabled={alreadyWatching || addToWatchlist.isPending}
                    onClick={() => addToWatchlist.mutate(item.ticker)}
                    title={alreadyWatching ? "Already watching" : `Add ${item.ticker} to watchlist`}
                  >
                    {alreadyWatching ? (
                      <span className="text-xs text-muted-foreground">Watching</span>
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────

export default function News() {
  const [filterSymbol, setFilterSymbol] = useState<string>("all");

  const queryParam = filterSymbol === "all" ? "" : `?symbol=${filterSymbol}`;
  const { data: news, isLoading } = useQuery<NewsItem[]>({
    queryKey: ["/api/news", filterSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/news${queryParam}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: watchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const watchlistSymbols = watchlist?.map(w => w.symbol) || [];

  const uniqueNews = news ? Array.from(
    new Map(news.map(n => [`${n.symbol}:${n.headline}`, n])).values()
  ).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()) : [];

  return (
    <div className="space-y-6" data-testid="news-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-news-title">Market News</h1>
          <p className="text-muted-foreground">
            {filterSymbol === "MARKET"
              ? "General market news from Finnhub"
              : filterSymbol === "all"
              ? "All news — market-wide and company-specific"
              : `News for ${filterSymbol}`}
          </p>
        </div>
        <Badge variant="outline" className="text-xs" data-testid="text-news-count">
          {uniqueNews.length} article{uniqueNews.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Market Buzz Panel — broad market intelligence */}
      <MarketBuzzPanel watchlistSymbols={watchlistSymbols} />

      <Select value={filterSymbol} onValueChange={setFilterSymbol}>
        <SelectTrigger className="w-[220px]" data-testid="select-news-filter">
          <SelectValue placeholder="Filter by source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All News</SelectItem>
          <SelectItem value="MARKET">General Market News</SelectItem>
          {watchlist?.map(w => (
            <SelectItem key={w.symbol} value={w.symbol}>{w.symbol} - {w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : uniqueNews.length > 0 ? (
        <div className="space-y-3">
          {uniqueNews.map((item) => (
            <Card key={item.id} data-testid={`news-item-${item.id}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${item.symbol === "MARKET" ? "bg-blue-500/10" : "bg-primary/10"}`}>
                    {item.symbol === "MARKET"
                      ? <Globe className="h-5 w-5 text-blue-500" />
                      : <Newspaper className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="secondary"
                        className={`text-xs ${item.symbol === "MARKET" ? "bg-blue-500/10 text-blue-600" : ""}`}
                      >
                        {item.symbol === "MARKET" ? "MARKET" : item.symbol}
                      </Badge>
                      <SentimentBadge sentiment={item.sentiment} />
                      <span className="text-xs text-muted-foreground ml-auto">{item.source}</span>
                    </div>
                    <h3 className="font-medium mt-2">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary transition-colors inline-flex items-center gap-1"
                          data-testid={`link-news-${item.id}`}
                        >
                          {item.headline}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      ) : item.headline}
                    </h3>
                    {item.summary && item.summary !== item.headline && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
                    )}
                    <span className="text-xs text-muted-foreground mt-2 block">
                      {new Date(item.publishedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Newspaper className="h-12 w-12 mx-auto mb-4 opacity-30" />
            No news yet — market intel scan running, headlines will appear shortly.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
