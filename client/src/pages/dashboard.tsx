import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Activity, Zap,
  ArrowUpRight, ArrowDownRight, Minus, Bot, Play, Square, Search,
  ShoppingCart, AlertCircle, SkipForward, Newspaper,
} from "lucide-react";
import type { TradingSignal, BotSettings } from "@shared/schema";
import { useState } from "react";

interface PortfolioHistoryPoint {
  date: string;
  equity: number;
  profitLoss: number;
  profitLossPct: number;
}

interface PortfolioHistory {
  baseValue: number;
  timeframe: string;
  points: PortfolioHistoryPoint[];
}

export default function Dashboard() {
  const [chartPeriod, setChartPeriod] = useState("1M");

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
  }>({ queryKey: ["/api/portfolio/summary"], refetchInterval: 5000 });

  const { data: signals } = useQuery<TradingSignal[]>({
    queryKey: ["/api/signals"],
  });

  const { data: settings } = useQuery<BotSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: autoTradeStatus } = useQuery<{ running: boolean; lastRun: string | null; logCount: number; newsMonitorRunning: boolean }>({
    queryKey: ["/api/autotrade/status"],
    refetchInterval: 5000,
  });

  const { data: autoTradeLog } = useQuery<Array<{
    id: number; timestamp: string; type: string; symbol?: string; message: string; details?: Record<string, any>;
  }>>({
    queryKey: ["/api/autotrade/log"],
    refetchInterval: 5000,
  });

  // Portfolio equity history from Alpaca
  const { data: portfolioHistory } = useQuery<PortfolioHistory>({
    queryKey: ["/api/portfolio/history", chartPeriod],
    queryFn: async () => {
      const timeframe = chartPeriod === "1D" ? "15Min" : "1D";
      const res = await fetch(`/api/portfolio/history?period=${chartPeriod}&timeframe=${timeframe}`);
      if (!res.ok) throw new Error("Failed to fetch portfolio history");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const generateAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/signals/generate-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
    },
  });

  const recentSignals = signals?.slice(0, 5) || [];

  // Top movers from positions (sorted by absolute P&L%)
  const topMovers = [...(summary?.positions || [])]
    .sort((a, b) => Math.abs(b.unrealizedPLPercent) - Math.abs(a.unrealizedPLPercent))
    .slice(0, 10);

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">
            Trading Dashboard
          </h1>
          <p className="text-muted-foreground">
            Real-time portfolio from Alpaca
          </p>
        </div>
        <div className="flex items-center gap-3">
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
                  ${summary?.totalValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0"}
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
                  ${summary?.cash?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Buying power: ${summary?.buyingPower?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-positions-value">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Holdings Value</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-7 w-28" /> : (
              <>
                <div className="text-2xl font-bold" data-testid="text-positions-value">
                  ${summary?.longMarketValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0"}
                </div>
                {summary?.positions && summary.positions.length > 0 ? (() => {
                  const totalPL = summary.positions.reduce((s, p) => s + p.unrealizedPL, 0);
                  return (
                    <p className={`text-xs font-medium ${totalPL >= 0 ? "text-emerald-600" : "text-red-500"}`} data-testid="text-total-unrealized-pl">
                      {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)} unrealized · {summary.positions.length} position{summary.positions.length !== 1 ? "s" : ""}
                    </p>
                  );
                })() : (
                  <p className="text-xs text-muted-foreground">No open positions</p>
                )}
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

      {/* Portfolio Equity Chart + Top Movers */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4" data-testid="card-equity-chart">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Portfolio Equity</CardTitle>
            <Select value={chartPeriod} onValueChange={setChartPeriod}>
              <SelectTrigger className="w-[100px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1D">1 Day</SelectItem>
                <SelectItem value="1W">1 Week</SelectItem>
                <SelectItem value="1M">1 Month</SelectItem>
                <SelectItem value="3M">3 Months</SelectItem>
                <SelectItem value="1A">1 Year</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {portfolioHistory && portfolioHistory.points?.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={portfolioHistory.points}>
                    <defs>
                      <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d) => chartPeriod === "1D" ? d.split("T")[1]?.slice(0, 5) || d : d.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: "8px", border: "1px solid hsl(210, 15%, 88%)" }}
                      formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Equity"]}
                    />
                    <Area type="monotone" dataKey="equity" stroke="hsl(142, 71%, 45%)" fill="url(#colorEquity)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>Base: ${portfolioHistory.baseValue?.toLocaleString()}</span>
                  {portfolioHistory.points.length > 0 && (() => {
                    const last = portfolioHistory.points[portfolioHistory.points.length - 1];
                    const pct = last.profitLossPct ? (last.profitLossPct * 100).toFixed(2) : "0.00";
                    const pl = last.profitLoss || 0;
                    return (
                      <span className={pl >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                        {pl >= 0 ? "+" : ""}${pl.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({pct}%)
                      </span>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                Waiting for Alpaca portfolio history...
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Movers from your positions */}
        <Card className="lg:col-span-3" data-testid="card-top-movers">
          <CardHeader>
            <CardTitle className="text-lg">Your Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topMovers.length > 0 ? topMovers.map((p) => (
                <div key={p.symbol} className="flex items-center justify-between py-2 border-b border-border last:border-0" data-testid={`quote-row-${p.symbol}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{p.symbol}</span>
                    <span className="text-xs text-muted-foreground">{p.qty} shares</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">${p.currentPrice.toFixed(2)}</div>
                    <Badge
                      variant={p.unrealizedPL >= 0 ? "default" : "destructive"}
                      className={`text-xs ${p.unrealizedPL >= 0 ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 border-0" : "bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0"}`}
                      data-testid={`badge-change-${p.symbol}`}
                    >
                      {p.unrealizedPL >= 0 ? "+" : ""}{p.unrealizedPLPercent.toFixed(2)}% (${p.unrealizedPL >= 0 ? "+" : ""}${p.unrealizedPL.toFixed(2)})
                    </Badge>
                  </div>
                </div>
              )) : (
                <p className="text-muted-foreground text-center py-8 text-sm">
                  No open positions — connect Alpaca to see your holdings
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Open Positions Table */}
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
                <tfoot>
                  {(() => {
                    const totalMV = summary.positions.reduce((s, p) => s + p.marketValue, 0);
                    const totalPL = summary.positions.reduce((s, p) => s + p.unrealizedPL, 0);
                    const totalCost = summary.positions.reduce((s, p) => s + p.avgEntry * p.qty, 0);
                    const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
                    return (
                      <tr className="border-t-2 border-border font-semibold" data-testid="position-row-total">
                        <td className="py-3">Total</td>
                        <td className="py-3 text-right">{summary.positions.reduce((s, p) => s + p.qty, 0)}</td>
                        <td className="py-3 text-right"></td>
                        <td className="py-3 text-right"></td>
                        <td className="py-3 text-right" data-testid="text-total-market-value">${totalMV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`py-3 text-right ${totalPL >= 0 ? "text-emerald-600" : "text-red-500"}`} data-testid="text-total-pl">
                          {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}
                        </td>
                        <td className={`py-3 text-right ${totalPLPct >= 0 ? "text-emerald-600" : "text-red-500"}`} data-testid="text-total-pl-pct">
                          {totalPLPct >= 0 ? "+" : ""}{totalPLPct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })()}
                </tfoot>
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
