import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useState } from "react";
import { Newspaper, TrendingUp, TrendingDown, Minus, Globe, ExternalLink } from "lucide-react";
import type { NewsItem, WatchlistItem } from "@shared/schema";

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
    refetchInterval: 60000,
  });

  const { data: watchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

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
            No news available. Turn off simulation mode in Settings to see live Finnhub news.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
