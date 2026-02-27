import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Activity, Zap,
  ArrowUpRight, ArrowDownRight, Minus, Bot, Play, Square, Search,
  ShoppingCart, AlertCircle, SkipForward, Newspaper,
} from "lucide-react";
import type { StockQuote, TradingSignal, HistoricalDataPoint, BotSettings } from "@shared/schema";

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useQuery<{
    totalValue: number;
    totalChange: number;
    totalChangePercent: number;
    cash: number;
    buyingPower: number;
    longMarketValue: number;
    positions: Array<{
      symbol: string;
      qty: number;
      avgEntry: number;
      currentPrice: number;
      marketValue: number;
      unrealizedPL: number;
      unrealizedPLPercent: number;
      side: string;
    }>;
    stockCount: number;
    buySignals: number;
    sellSignals: number;
    holdSignals: number;
    quotes: StockQuote[];
  }>({ queryKey: ["/api/portfolio/summary"], refetchInterval: 30000 });

  const { data: signals } = useQuery<TradingSignal[]>({
    queryKey: ["/api/signals"],
  });

  const { data: settings } = useQuery<BotSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: autoTradeStatus } = useQuery<{ running: boolean; lastRun: string | null; logCount: number; newsMonitorRunning: boolean }>({
    queryKey: ["/api/autotrade/status"],
    refetchInterval: 10000,
  });

  const { data: autoTradeLog } = useQuery<Array<{
    id: number; timestamp: string; type: string; symbol?: string; message: string; details?: Record<string, any>;
  }>>({
    queryKey: ["/api/autotrade/log"],
    refetchInterval: 10000,
  });

  const { data: historyAAPL } = useQuery<HistoricalDataPoint[]>({
    queryKey: ["/api/history/AAPL"],
  });

  const generateAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/signals/generate-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
    },
  });

  const recentSignals = signals?.slice(0, 5) || [];

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">
            Trading Dashboard
          </h1>
          <p className="text-muted-foreground">
            Monitor your portfolio and trading signals
          </p>
        </div>
        <div className="flex items-center gap-3">
          {settings?.simulationMode && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30" data-testid="badge-simulation">
              Simulation Mode
            </Badge>
          )}
          <Button
            onClick={() => generateAll.mutate()}
            disabled={generateAll.isPending}
            data-testid="button-generate-signals"
          >
            <Zap className="mr-2 h-4 w-4" />
            {generateAll.isPending ? "Analyzing..." : "Generate AI Signals"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-portfolio-value">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Portfolio Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-portfolio-value">
                  ${summary?.totalValue?.toLocaleString() || "0"}
                </div>
                <p className={`text-xs flex items-center gap-1 ${(summary?.totalChange || 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {(summary?.totalChange || 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {(summary?.totalChangePercent || 0) >= 0 ? "+" : ""}{summary?.totalChangePercent || 0}% today
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-cash-balance">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cash Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-7 w-28" /> : (
              <>
                <div className="text-2xl font-bold" data-testid="text-cash-balance">
                  ${summary?.cash?.toLocaleString() || "0"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Buying power: ${summary?.buyingPower?.toLocaleString() || "0"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-positions-value">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Positions Value</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-7 w-28" /> : (
              <>
                <div className="text-2xl font-bold" data-testid="text-positions-value">
                  ${summary?.longMarketValue?.toLocaleString() || "0"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary?.positions?.length || 0} open position{(summary?.positions?.length || 0) !== 1 ? "s" : ""}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-signals-summary">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Signals</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-emerald-600" data-testid="text-buy-count">{summary?.buySignals || 0} <span className="text-xs font-normal">BUY</span></span>
              <span className="text-lg font-bold text-red-500" data-testid="text-sell-count">{summary?.sellSignals || 0} <span className="text-xs font-normal">SELL</span></span>
              <span className="text-lg font-bold text-amber-500">{summary?.holdSignals || 0} <span className="text-xs font-normal">HOLD</span></span>
            </div>
            <p className="text-xs text-muted-foreground">{summary?.stockCount || 0} stocks tracked</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4" data-testid="card-price-chart">
          <CardHeader>
            <CardTitle className="text-lg">AAPL Price History</CardTitle>
          </CardHeader>
          <CardContent>
            {historyAAPL ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={historyAAPL}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 91%, 48%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217, 91%, 48%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ borderRadius: "8px", border: "1px solid hsl(210, 15%, 88%)" }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]}
                  />
                  <Area type="monotone" dataKey="close" stroke="hsl(217, 91%, 48%)" fill="url(#colorPrice)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[300px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" data-testid="card-live-quotes">
          <CardHeader>
            <CardTitle className="text-lg">Live Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {summary?.quotes?.map((q) => (
                <div key={q.symbol} className="flex items-center justify-between py-2 border-b border-border last:border-0" data-testid={`quote-row-${q.symbol}`}>
                  <div>
                    <span className="font-semibold">{q.symbol}</span>
                    <span className="text-sm text-muted-foreground ml-2">${q.price.toFixed(2)}</span>
                  </div>
                  <Badge
                    variant={q.change >= 0 ? "default" : "destructive"}
                    className={q.change >= 0 ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 border-0" : "bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0"}
                    data-testid={`badge-change-${q.symbol}`}
                  >
                    {q.change >= 0 ? "+" : ""}{q.changePercent}%
                  </Badge>
                </div>
              )) || <Skeleton className="h-40 w-full" />}
            </div>
          </CardContent>
        </Card>
      </div>

      {summary?.positions && summary.positions.length > 0 && (
        <Card data-testid="card-open-positions">
          <CardHeader>
            <CardTitle className="text-lg">Open Positions (Alpaca)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Symbol</th>
                    <th className="pb-2 font-medium text-right">Qty</th>
                    <th className="pb-2 font-medium text-right">Avg Entry</th>
                    <th className="pb-2 font-medium text-right">Current</th>
                    <th className="pb-2 font-medium text-right">Market Value</th>
                    <th className="pb-2 font-medium text-right">P&L</th>
                    <th className="pb-2 font-medium text-right">P&L %</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.positions.map((p) => (
                    <tr key={p.symbol} className="border-b last:border-0" data-testid={`position-row-${p.symbol}`}>
                      <td className="py-2 font-semibold">{p.symbol}</td>
                      <td className="py-2 text-right">{p.qty}</td>
                      <td className="py-2 text-right">${p.avgEntry.toFixed(2)}</td>
                      <td className="py-2 text-right">${p.currentPrice.toFixed(2)}</td>
                      <td className="py-2 text-right">${p.marketValue.toLocaleString()}</td>
                      <td className={`py-2 text-right font-medium ${p.unrealizedPL >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {p.unrealizedPL >= 0 ? "+" : ""}${p.unrealizedPL.toFixed(2)}
                      </td>
                      <td className={`py-2 text-right font-medium ${p.unrealizedPLPercent >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {p.unrealizedPLPercent >= 0 ? "+" : ""}{p.unrealizedPLPercent.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-recent-signals">
        <CardHeader>
          <CardTitle className="text-lg">Recent Signals</CardTitle>
        </CardHeader>
        <CardContent>
          {recentSignals.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No signals yet. Click "Generate AI Signals" to analyze your watchlist.
            </p>
          ) : (
            <div className="space-y-3">
              {recentSignals.map((sig) => (
                <div key={sig.id} className="flex items-start gap-3 p-3 rounded-lg bg-card border border-card-border" data-testid={`signal-card-${sig.id}`}>
                  <div className={`mt-1 p-1.5 rounded-md ${sig.signal === "BUY" ? "bg-emerald-500/15 text-emerald-600" : sig.signal === "SELL" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600"}`}>
                    {sig.signal === "BUY" ? <ArrowUpRight className="h-4 w-4" /> : sig.signal === "SELL" ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{sig.symbol}</span>
                      <Badge variant="outline" className={`text-xs ${sig.signal === "BUY" ? "text-emerald-600 border-emerald-500/30" : sig.signal === "SELL" ? "text-red-500 border-red-500/30" : "text-amber-600 border-amber-500/30"}`}>
                        {sig.signal}
                      </Badge>
                      <span className="text-xs text-muted-foreground">${sig.price.toFixed(2)}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {(sig.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 truncate">{sig.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {(autoTradeStatus?.running || autoTradeStatus?.newsMonitorRunning || (autoTradeLog && autoTradeLog.length > 0)) && (
        <Card data-testid="card-auto-trade-activity">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Auto-Trade Activity
              {autoTradeStatus?.running && (
                <Badge className="bg-emerald-500/15 text-emerald-600 border-0 ml-2">Auto-Trade On</Badge>
              )}
              {autoTradeStatus?.newsMonitorRunning && (
                <Badge className="bg-orange-500/15 text-orange-600 border-0 ml-2">News Monitor On</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {autoTradeLog && autoTradeLog.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {autoTradeLog.slice(0, 20).map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 text-sm py-1.5 border-b border-border last:border-0" data-testid={`autotrade-log-${entry.id}`}>
                    <div className="mt-0.5">
                      {entry.type === "trade" && <ShoppingCart className="h-3.5 w-3.5 text-emerald-500" />}
                      {entry.type === "scan" && <Search className="h-3.5 w-3.5 text-blue-500" />}
                      {entry.type === "signal" && <Activity className="h-3.5 w-3.5 text-purple-500" />}
                      {entry.type === "skip" && <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />}
                      {entry.type === "error" && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
                      {entry.type === "start" && <Play className="h-3.5 w-3.5 text-emerald-500" />}
                      {entry.type === "stop" && <Square className="h-3.5 w-3.5 text-amber-500" />}
                      {entry.type === "news" && <Newspaper className="h-3.5 w-3.5 text-orange-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {entry.symbol && <span className="font-semibold text-xs">{entry.symbol}</span>}
                        <span className="text-muted-foreground truncate">{entry.message}</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No auto-trade activity yet. Enable Auto-Trade in Settings to get started.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
