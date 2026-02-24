import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { Plus, Trash2, TrendingUp, TrendingDown, Eye } from "lucide-react";
import type { WatchlistItem, StockQuote, HistoricalDataPoint } from "@shared/schema";

export default function Watchlist() {
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: watchlist, isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const { data: quotes } = useQuery<StockQuote[]>({
    queryKey: ["/api/quotes"],
  });

  const { data: history } = useQuery<HistoricalDataPoint[]>({
    queryKey: [`/api/history/${selectedSymbol}`],
    enabled: !!selectedSymbol,
  });

  const addItem = useMutation({
    mutationFn: (data: { symbol: string; name: string }) =>
      apiRequest("POST", "/api/watchlist", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
      setNewSymbol("");
      setNewName("");
      toast({ title: "Added to watchlist" });
    },
  });

  const removeItem = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/watchlist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const quoteMap = new Map(quotes?.map(q => [q.symbol, q]) || []);

  return (
    <div className="space-y-6" data-testid="watchlist-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-watchlist-title">Watchlist</h1>
        <p className="text-muted-foreground">Manage the stocks you're tracking</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Symbol (e.g., AAPL)"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              className="max-w-[150px]"
              data-testid="input-symbol"
            />
            <Input
              placeholder="Company name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="max-w-[250px]"
              data-testid="input-name"
            />
            <Button
              onClick={() => addItem.mutate({ symbol: newSymbol, name: newName || newSymbol })}
              disabled={!newSymbol || addItem.isPending}
              data-testid="button-add-stock"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))
        ) : (
          watchlist?.map((item) => {
            const q = quoteMap.get(item.symbol);
            return (
              <Card key={item.id} className="relative group" data-testid={`card-stock-${item.symbol}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{item.symbol}</h3>
                      <p className="text-sm text-muted-foreground">{item.name}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSelectedSymbol(item.symbol === selectedSymbol ? null : item.symbol)}
                        data-testid={`button-view-${item.symbol}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-500"
                        onClick={() => removeItem.mutate(item.id)}
                        data-testid={`button-remove-${item.symbol}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {q && (
                    <div className="mt-3 flex items-end justify-between">
                      <span className="text-2xl font-bold" data-testid={`text-price-${item.symbol}`}>${q.price.toFixed(2)}</span>
                      <div className="flex items-center gap-1">
                        {q.change >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                        <Badge
                          variant="outline"
                          className={q.change >= 0 ? "text-emerald-600 border-emerald-500/30" : "text-red-500 border-red-500/30"}
                        >
                          {q.change >= 0 ? "+" : ""}{q.changePercent}%
                        </Badge>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>H: ${q?.high.toFixed(2)}</div>
                    <div>L: ${q?.low.toFixed(2)}</div>
                    <div>V: {q ? (q.volume / 1_000_000).toFixed(1) + "M" : "-"}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {selectedSymbol && history && (
        <Card data-testid="card-stock-chart">
          <CardHeader>
            <CardTitle>{selectedSymbol} - 90 Day Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorChart" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217, 91%, 48%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(217, 91%, 48%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]} />
                <Area type="monotone" dataKey="close" stroke="hsl(217, 91%, 48%)" fill="url(#colorChart)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
