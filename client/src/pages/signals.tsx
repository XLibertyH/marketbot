import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useState } from "react";
import { ArrowUpRight, ArrowDownRight, Minus, Zap, RefreshCw } from "lucide-react";
import type { TradingSignal, WatchlistItem } from "@shared/schema";

export default function Signals() {
  const [filterSymbol, setFilterSymbol] = useState<string>("all");

  const { data: signals, isLoading } = useQuery<TradingSignal[]>({
    queryKey: ["/api/signals"],
  });

  const { data: watchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const generateSingle = useMutation({
    mutationFn: (symbol: string) =>
      apiRequest("POST", "/api/signals/generate", { symbol }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
    },
  });

  const generateAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/signals/generate-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
    },
  });

  const filtered = filterSymbol === "all"
    ? signals
    : signals?.filter(s => s.symbol === filterSymbol);

  return (
    <div className="space-y-6" data-testid="signals-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-signals-title">Trading Signals</h1>
          <p className="text-muted-foreground">AI-powered buy/sell recommendations</p>
        </div>
        <Button
          onClick={() => generateAll.mutate()}
          disabled={generateAll.isPending}
          data-testid="button-generate-all"
        >
          <Zap className="mr-2 h-4 w-4" />
          {generateAll.isPending ? "Analyzing..." : "Analyze All"}
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Select value={filterSymbol} onValueChange={setFilterSymbol}>
          <SelectTrigger className="w-[180px]" data-testid="select-filter-symbol">
            <SelectValue placeholder="Filter by symbol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Symbols</SelectItem>
            {watchlist?.map(w => (
              <SelectItem key={w.symbol} value={w.symbol}>{w.symbol}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2 ml-auto">
          {watchlist?.map(w => (
            <Button
              key={w.symbol}
              variant="outline"
              size="sm"
              onClick={() => generateSingle.mutate(w.symbol)}
              disabled={generateSingle.isPending}
              data-testid={`button-analyze-${w.symbol}`}
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${generateSingle.isPending ? "animate-spin" : ""}`} />
              {w.symbol}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((sig) => (
            <Card key={sig.id} data-testid={`signal-detail-${sig.id}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`p-2.5 rounded-lg ${sig.signal === "BUY" ? "bg-emerald-500/15 text-emerald-600" : sig.signal === "SELL" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600"}`}>
                    {sig.signal === "BUY" ? <ArrowUpRight className="h-5 w-5" /> : sig.signal === "SELL" ? <ArrowDownRight className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-lg font-semibold">{sig.symbol}</span>
                      <Badge className={`${sig.signal === "BUY" ? "bg-emerald-500 hover:bg-emerald-600" : sig.signal === "SELL" ? "bg-red-500 hover:bg-red-600" : "bg-amber-500 hover:bg-amber-600"} text-white`}>
                        {sig.signal}
                      </Badge>
                      <span className="text-muted-foreground">${sig.price.toFixed(2)}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(sig.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">{sig.reason}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Confidence:</span>
                      <Progress value={sig.confidence * 100} className="h-2 flex-1 max-w-[200px]" />
                      <span className="text-sm font-medium">{(sig.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No signals generated yet. Click "Analyze All" to generate AI-powered trading signals for your watchlist.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
