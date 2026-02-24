import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useState } from "react";
import { Newspaper, TrendingUp, TrendingDown, Minus } from "lucide-react";
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

  const querySymbol = filterSymbol === "all" ? undefined : filterSymbol;
  const { data: news, isLoading } = useQuery<NewsItem[]>({
    queryKey: [querySymbol ? `/api/news?symbol=${querySymbol}` : "/api/news"],
  });

  const { data: watchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  return (
    <div className="space-y-6" data-testid="news-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-news-title">Market News</h1>
          <p className="text-muted-foreground">News sentiment analysis for your watchlist</p>
        </div>
      </div>

      <Select value={filterSymbol} onValueChange={setFilterSymbol}>
        <SelectTrigger className="w-[180px]" data-testid="select-news-filter">
          <SelectValue placeholder="Filter by symbol" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Stocks</SelectItem>
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
      ) : news && news.length > 0 ? (
        <div className="space-y-3">
          {news.map((item) => (
            <Card key={item.id} data-testid={`news-item-${item.id}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Newspaper className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">{item.symbol}</Badge>
                      <SentimentBadge sentiment={item.sentiment} />
                      <span className="text-xs text-muted-foreground ml-auto">{item.source}</span>
                    </div>
                    <h3 className="font-medium mt-2">{item.headline}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{item.summary}</p>
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
            No news available. Select a stock from the filter to load news.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
