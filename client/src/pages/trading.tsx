import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet, TrendingUp, TrendingDown, ShoppingCart, X, RefreshCw, DollarSign,
  ArrowUpRight, ArrowDownRight, Package, Clock, AlertTriangle, Shield
} from "lucide-react";
import { useState } from "react";
import type { BotSettings } from "@shared/schema";

interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  change_today: string;
  side: string;
}

interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  filled_avg_price: string | null;
  status: string;
  created_at: string;
  filled_at: string | null;
}

interface PreflightResult {
  estimatedValue: number;
  accountEquity: number;
  buyingPower: number;
  dailyOrderCount: number;
  maxDailyOrders: number;
  dailyPL: number;
  maxDailyLoss: number;
  isLive: boolean;
  warnings: string[];
}

export default function Trading() {
  const { toast } = useToast();
  const [orderSymbol, setOrderSymbol] = useState("");
  const [orderQty, setOrderQty] = useState("1");
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [orderTif, setOrderTif] = useState<"day" | "gtc">("day");
  const [limitPrice, setLimitPrice] = useState("");
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [preflightData, setPreflightData] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const { data: status } = useQuery<{ connected: boolean; isLive: boolean }>({
    queryKey: ["/api/alpaca/status"],
    refetchInterval: 1000,
  });

  const { data: settings } = useQuery<BotSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: account, isLoading: accountLoading } = useQuery<AlpacaAccount>({
    queryKey: ["/api/alpaca/account"],
    enabled: status?.connected === true,
    refetchInterval: 1000,
  });

  const { data: positions, isLoading: positionsLoading } = useQuery<AlpacaPosition[]>({
    queryKey: ["/api/alpaca/positions"],
    enabled: status?.connected === true,
    refetchInterval: 1000,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<AlpacaOrder[]>({
    queryKey: ["/api/alpaca/orders"],
    enabled: status?.connected === true,
    refetchInterval: 1000,
  });

  const placeOrderMutation = useMutation({
    mutationFn: (data: { symbol: string; qty: number; side: string; type: string; time_in_force: string; limit_price?: number }) =>
      apiRequest("POST", "/api/alpaca/orders", data),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/positions"] });
      const warningText = data.warnings?.length ? `\n${data.warnings.join("\n")}` : "";
      toast({ title: "Order placed successfully", description: warningText || undefined });
      setConfirmDialogOpen(false);
      setOrderDialogOpen(false);
      resetOrderForm();
    },
    onError: (error: Error) => {
      toast({ title: "Order blocked", description: error.message, variant: "destructive" });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: (orderId: string) => apiRequest("DELETE", `/api/alpaca/orders/${orderId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/account"] });
      toast({ title: "Order cancelled" });
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: (symbol: string) => apiRequest("DELETE", `/api/alpaca/positions/${symbol}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/orders"] });
      toast({ title: "Position closed" });
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/alpaca/account"] });
    queryClient.invalidateQueries({ queryKey: ["/api/alpaca/positions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/alpaca/orders"] });
  };

  const resetOrderForm = () => {
    setOrderSymbol("");
    setOrderQty("1");
    setLimitPrice("");
    setPreflightData(null);
  };

  const handleReviewOrder = async () => {
    if (!orderSymbol || !orderQty) return;
    setPreflightLoading(true);
    try {
      const res = await apiRequest("POST", "/api/alpaca/orders/preflight", {
        symbol: orderSymbol.toUpperCase(),
        qty: Number(orderQty),
        side: orderSide,
        type: orderType,
        limit_price: orderType === "limit" && limitPrice ? Number(limitPrice) : undefined,
      });
      const data = await res.json();
      setPreflightData(data);
      setOrderDialogOpen(false);
      setConfirmDialogOpen(true);
    } catch (error: any) {
      toast({ title: "Preflight check failed", description: error.message, variant: "destructive" });
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleConfirmOrder = () => {
    placeOrderMutation.mutate({
      symbol: orderSymbol.toUpperCase(),
      qty: Number(orderQty),
      side: orderSide,
      type: orderType,
      time_in_force: orderTif,
      limit_price: orderType === "limit" && limitPrice ? Number(limitPrice) : undefined,
    });
  };

  const isLive = status?.isLive || false;

  if (status?.connected === false) {
    return (
      <div className="space-y-6" data-testid="trading-page">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-trading-title">Trading</h1>
          <p className="text-muted-foreground">Alpaca trading integration</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
            <h2 className="text-lg font-semibold mb-2">Alpaca Not Connected</h2>
            <p className="text-muted-foreground text-center max-w-md">
              Your Alpaca API keys could not be verified. Please check that your API key and secret key are correctly set in your environment secrets.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const equity = parseFloat(account?.equity || "0");
  const lastEquity = parseFloat(account?.last_equity || "0");
  const dayPl = equity - lastEquity;
  const dayPlPct = lastEquity > 0 ? (dayPl / lastEquity) * 100 : 0;

  const openOrders = orders?.filter(o => ["new", "accepted", "pending_new", "partially_filled"].includes(o.status)) || [];
  const recentFilled = orders?.filter(o => o.status === "filled").slice(0, 10) || [];

  return (
    <div className="space-y-6" data-testid="trading-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-trading-title">
            {isLive ? "Live Trading" : "Paper Trading"}
          </h1>
          <p className="text-muted-foreground">
            {isLive ? "Alpaca live trading account — real money" : "Alpaca paper trading account"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLive ? (
            <Badge className="bg-red-500 hover:bg-red-600 text-white" data-testid="badge-live">
              <AlertTriangle className="h-3 w-3 mr-1" />
              LIVE — Real Money
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/15 text-emerald-600 border-0" data-testid="badge-paper">
              Paper Account
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={refreshAll} data-testid="button-refresh-trading">
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Dialog open={orderDialogOpen} onOpenChange={(open) => { setOrderDialogOpen(open); if (!open) resetOrderForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-order">
                <ShoppingCart className="h-4 w-4 mr-2" />
                New Order
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-new-order">
              <DialogHeader>
                <DialogTitle>
                  {isLive ? "Place Live Trade" : "Place Paper Trade"}
                </DialogTitle>
                <DialogDescription>
                  {isLive
                    ? "This order will be placed on your live account with real money"
                    : "Submit an order to your Alpaca paper trading account"}
                </DialogDescription>
              </DialogHeader>

              {isLive && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-sm" data-testid="warning-live-order">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>You are placing a LIVE order. Real money will be used.</span>
                </div>
              )}

              <div className="space-y-4 py-2">
                <div>
                  <Label>Symbol</Label>
                  <Input
                    placeholder="e.g. AAPL"
                    value={orderSymbol}
                    onChange={(e) => setOrderSymbol(e.target.value.toUpperCase())}
                    data-testid="input-order-symbol"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Side</Label>
                    <Select value={orderSide} onValueChange={(v) => setOrderSide(v as "buy" | "sell")}>
                      <SelectTrigger data-testid="select-order-side"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buy">Buy</SelectItem>
                        <SelectItem value="sell">Sell</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="1"
                      value={orderQty}
                      onChange={(e) => setOrderQty(e.target.value)}
                      data-testid="input-order-qty"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Order Type</Label>
                    <Select value={orderType} onValueChange={(v) => setOrderType(v as "market" | "limit")}>
                      <SelectTrigger data-testid="select-order-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="market">Market</SelectItem>
                        <SelectItem value="limit">Limit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Time in Force</Label>
                    <Select value={orderTif} onValueChange={(v) => setOrderTif(v as "day" | "gtc")}>
                      <SelectTrigger data-testid="select-order-tif"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="gtc">GTC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {orderType === "limit" && (
                  <div>
                    <Label>Limit Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      data-testid="input-limit-price"
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleReviewOrder}
                  disabled={!orderSymbol || !orderQty || preflightLoading}
                  variant="outline"
                  data-testid="button-review-order"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  {preflightLoading ? "Checking..." : "Review Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
            <DialogContent data-testid="dialog-confirm-order">
              <DialogHeader>
                <DialogTitle>
                  {isLive ? "Confirm Live Order" : "Confirm Order"}
                </DialogTitle>
                <DialogDescription>Review the details below before confirming</DialogDescription>
              </DialogHeader>

              {isLive && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-sm font-medium" data-testid="warning-live-confirm">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                  <span>LIVE TRADING — This will execute with real money. This action cannot be undone.</span>
                </div>
              )}

              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 rounded-lg bg-muted/50 border">
                  <div className="text-sm text-muted-foreground">Symbol</div>
                  <div className="text-sm font-semibold">{orderSymbol}</div>
                  <div className="text-sm text-muted-foreground">Side</div>
                  <div className={`text-sm font-semibold ${orderSide === "buy" ? "text-emerald-600" : "text-red-500"}`}>
                    {orderSide.toUpperCase()}
                  </div>
                  <div className="text-sm text-muted-foreground">Quantity</div>
                  <div className="text-sm font-semibold">{orderQty} shares</div>
                  <div className="text-sm text-muted-foreground">Type</div>
                  <div className="text-sm font-semibold">{orderType}{orderType === "limit" ? ` @ $${limitPrice}` : ""}</div>
                  <div className="text-sm text-muted-foreground">Time in Force</div>
                  <div className="text-sm font-semibold">{orderTif.toUpperCase()}</div>
                  {preflightData && (
                    <>
                      <div className="text-sm text-muted-foreground">Est. Value</div>
                      <div className="text-sm font-semibold">${preflightData.estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="text-sm text-muted-foreground">Buying Power</div>
                      <div className="text-sm font-semibold">${preflightData.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="text-sm text-muted-foreground">Daily Orders</div>
                      <div className="text-sm font-semibold">{preflightData.dailyOrderCount} / {preflightData.maxDailyOrders}</div>
                      <div className="text-sm text-muted-foreground">Daily P&L</div>
                      <div className={`text-sm font-semibold ${preflightData.dailyPL >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {preflightData.dailyPL >= 0 ? "+" : ""}${preflightData.dailyPL.toFixed(2)}
                      </div>
                    </>
                  )}
                </div>

                {preflightData?.warnings && preflightData.warnings.length > 0 && (
                  <div className="space-y-2">
                    {preflightData.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 text-sm" data-testid={`warning-preflight-${i}`}>
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setConfirmDialogOpen(false); setOrderDialogOpen(true); }} data-testid="button-back-to-edit">
                  Back
                </Button>
                <Button
                  onClick={handleConfirmOrder}
                  disabled={placeOrderMutation.isPending}
                  className={isLive
                    ? "bg-red-600 hover:bg-red-700"
                    : orderSide === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
                  data-testid="button-confirm-order"
                >
                  {placeOrderMutation.isPending ? "Placing..." : isLive
                    ? `Confirm LIVE ${orderSide.toUpperCase()}`
                    : `Confirm ${orderSide === "buy" ? "Buy" : "Sell"} ${orderSymbol}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLive && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30" data-testid="banner-live-mode">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-600">Live Trading Mode Active</p>
            <p className="text-xs text-red-500/80">
              All orders will be executed with real money. Safety limits: max ${settings?.maxOrderValue?.toLocaleString() || "5,000"}/order,
              max {settings?.maxDailyOrders || 20} orders/day, ${settings?.maxDailyLoss?.toLocaleString() || "1,000"} daily loss limit.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-equity">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Equity</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {accountLoading ? <Skeleton className="h-7 w-28" /> : (
              <>
                <div className="text-2xl font-bold" data-testid="text-equity">
                  ${parseFloat(account?.equity || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <p className={`text-xs flex items-center gap-1 ${dayPl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {dayPl >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {dayPl >= 0 ? "+" : ""}{dayPlPct.toFixed(2)}% today
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-buying-power">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Buying Power</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {accountLoading ? <Skeleton className="h-7 w-28" /> : (
              <div className="text-2xl font-bold" data-testid="text-buying-power">
                ${parseFloat(account?.buying_power || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-cash">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cash</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {accountLoading ? <Skeleton className="h-7 w-28" /> : (
              <div className="text-2xl font-bold" data-testid="text-cash">
                ${parseFloat(account?.cash || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-positions-count">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Positions</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {positionsLoading ? <Skeleton className="h-7 w-12" /> : (
              <div className="text-2xl font-bold" data-testid="text-positions-count">
                {positions?.length || 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="card-positions">
          <CardHeader>
            <CardTitle className="text-lg">Positions</CardTitle>
            <CardDescription>Current holdings in your {isLive ? "live" : "paper"} account</CardDescription>
          </CardHeader>
          <CardContent>
            {positionsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !positions?.length ? (
              <p className="text-muted-foreground text-center py-8">No open positions</p>
            ) : (
              <div className="space-y-2">
                {positions.map((pos) => {
                  const pl = parseFloat(pos.unrealized_pl);
                  const plPct = parseFloat(pos.unrealized_plpc) * 100;
                  return (
                    <div key={pos.symbol} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`position-row-${pos.symbol}`}>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{pos.symbol}</span>
                          <span className="text-sm text-muted-foreground">{pos.qty} shares</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Avg: ${parseFloat(pos.avg_entry_price).toFixed(2)} | Current: ${parseFloat(pos.current_price).toFixed(2)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-sm font-medium">${parseFloat(pos.market_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                          <div className={`text-xs flex items-center gap-1 justify-end ${pl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {pl >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {pl >= 0 ? "+" : ""}{plPct.toFixed(2)}%
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={() => closePositionMutation.mutate(pos.symbol)}
                          disabled={closePositionMutation.isPending}
                          data-testid={`button-close-${pos.symbol}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-open-orders">
          <CardHeader>
            <CardTitle className="text-lg">Open Orders</CardTitle>
            <CardDescription>Pending orders waiting to be filled</CardDescription>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !openOrders.length ? (
              <p className="text-muted-foreground text-center py-8">No open orders</p>
            ) : (
              <div className="space-y-2">
                {openOrders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`order-row-${order.id}`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{order.symbol}</span>
                        <Badge variant={order.side === "buy" ? "default" : "destructive"} className={order.side === "buy" ? "bg-emerald-500/15 text-emerald-600 border-0" : "bg-red-500/15 text-red-500 border-0"}>
                          {order.side.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{order.type}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {order.qty} shares {order.limit_price ? `@ $${order.limit_price}` : "at market"} | {order.status}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      onClick={() => cancelOrderMutation.mutate(order.id)}
                      disabled={cancelOrderMutation.isPending}
                      data-testid={`button-cancel-${order.id}`}
                    >
                      <X className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-order-history">
        <CardHeader>
          <CardTitle className="text-lg">Recent Filled Orders</CardTitle>
          <CardDescription>Last 10 completed trades</CardDescription>
        </CardHeader>
        <CardContent>
          {ordersLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !recentFilled.length ? (
            <p className="text-muted-foreground text-center py-8">No filled orders yet</p>
          ) : (
            <div className="space-y-2">
              {recentFilled.map((order) => (
                <div key={order.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`filled-row-${order.id}`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-md ${order.side === "buy" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-500"}`}>
                      {order.side === "buy" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{order.symbol}</span>
                        <span className="text-sm text-muted-foreground">{order.filled_qty} shares</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {order.filled_at ? new Date(order.filled_at).toLocaleDateString() : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      ${order.filled_avg_price ? parseFloat(order.filled_avg_price).toFixed(2) : "—"}
                    </div>
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/30">Filled</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
