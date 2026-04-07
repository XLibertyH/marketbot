import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Shield, Gauge, Zap, AlertTriangle, ChevronRight } from "lucide-react";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import type { BotSettings } from "@shared/schema";
import { useState } from "react";

const riskPresets: Record<string, Partial<BotSettings>> = {
  low: {
    maxPositionSize: 1000,
    stopLossPercent: 3,
    takeProfitPercent: 5,
    maxOrderValue: 2000,
    maxDailyLoss: 500,
    maxDailyOrders: 5,
    autoTradeMinConfidence: 0.9,
    autoTradePositionSize: 200,
  },
  medium: {
    maxPositionSize: 5000,
    stopLossPercent: 5,
    takeProfitPercent: 10,
    maxOrderValue: 5000,
    maxDailyLoss: 1000,
    maxDailyOrders: 20,
    autoTradeMinConfidence: 0.75,
    autoTradePositionSize: 500,
  },
  "medium-controlled": {
    maxPositionSize: 10000,
    stopLossPercent: 5,
    takeProfitPercent: 10,
    maxOrderValue: 10000,
    maxDailyLoss: 2000,
    maxDailyOrders: 15,
    autoTradeMinConfidence: 0.78,
    autoTradePositionSize: 1000,
    maxEquityExposure: 150,
  },
  buffett: {
    maxPositionSize: 10000,
    stopLossPercent: 15,
    takeProfitPercent: 50,
    maxOrderValue: 10000,
    maxDailyLoss: 1000,
    maxDailyOrders: 5,
    autoTradeMinConfidence: 0.88,
    autoTradePositionSize: 5000,
    maxEquityExposure: 95,
  },
  high: {
    maxPositionSize: 25000,
    stopLossPercent: 10,
    takeProfitPercent: 25,
    maxOrderValue: 25000,
    maxDailyLoss: 5000,
    maxDailyOrders: 50,
    autoTradeMinConfidence: 0.6,
    autoTradePositionSize: 2000,
  },
};

export default function Settings() {
  const { toast } = useToast();
  const [symbolsInput, setSymbolsInput] = useState("");
  const [symbolsLoaded, setSymbolsLoaded] = useState(false);

  const { data: settings, isLoading } = useQuery<BotSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: alpacaStatus } = useQuery<{ connected: boolean; isLive: boolean }>({
    queryKey: ["/api/alpaca/status"],
  });

  const { data: apiKeyStatus } = useQuery<Record<string, any>>({
    queryKey: ["/api/api-keys/status"],
  });

  const [activeDialog, setActiveDialog] = useState<"ollama" | "alpaca" | "finnhub" | null>(null);

  const updateSettings = useMutation({
    mutationFn: (data: Partial<BotSettings>) =>
      apiRequest("PATCH", "/api/settings", data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      let title = "Settings updated";
      if (variables.autoTrade !== undefined) title = variables.autoTrade ? "Auto-trade enabled" : "Auto-trade disabled";
      else if (variables.riskLevel) title = `Risk level: ${variables.riskLevel}`;
      toast({ title });
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 mt-2" />
        </div>
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 mt-1" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!symbolsLoaded && settings.allowedSymbols !== undefined) {
    setSymbolsInput(settings.allowedSymbols);
    setSymbolsLoaded(true);
  }

  const isLive = alpacaStatus?.isLive || false;

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Bot Settings</h1>
        <p className="text-muted-foreground">Configure trading bot behavior and risk parameters</p>
      </div>

      <Card data-testid="card-mode-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Trading Mode
          </CardTitle>
          <CardDescription>Control whether the bot uses simulated or live data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Auto-Trade</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically execute trades based on AI signals
              </p>
            </div>
            <div className="flex items-center gap-3">
              {settings.autoTrade && (
                <Badge className="bg-emerald-500/15 text-emerald-600 border-0">Running</Badge>
              )}
              <Switch
                checked={settings.autoTrade}
                onCheckedChange={(checked) => updateSettings.mutate({ autoTrade: checked })}
                data-testid="switch-auto-trade"
              />
            </div>
          </div>

          {settings.autoTrade && (
            <div className="space-y-4 pl-4 border-l-2 border-primary/20">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-base">Scan Interval</Label>
                  <span className="text-sm font-medium" data-testid="text-auto-trade-interval">{settings.autoTradeInterval} min</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  How often the bot analyzes your watchlist and places trades
                </p>
                <Slider
                  value={[settings.autoTradeInterval]}
                  min={1}
                  max={60}
                  step={1}
                  className="mt-3"
                  onValueChange={([value]) => updateSettings.mutate({ autoTradeInterval: value })}
                  data-testid="slider-auto-trade-interval"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1 min</span>
                  <span>60 min</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-base">Min Confidence</Label>
                  <span className="text-sm font-medium" data-testid="text-auto-trade-confidence">{(settings.autoTradeMinConfidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Only execute trades when AI confidence exceeds this threshold
                </p>
                <Slider
                  value={[settings.autoTradeMinConfidence * 100]}
                  min={50}
                  max={95}
                  step={5}
                  className="mt-3"
                  onValueChange={([value]) => updateSettings.mutate({ autoTradeMinConfidence: value / 100 })}
                  data-testid="slider-auto-trade-confidence"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>50%</span>
                  <span>95%</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-base">Position Size</Label>
                  <span className="text-sm font-medium" data-testid="text-auto-trade-position-size">${settings.autoTradePositionSize.toLocaleString()}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Dollar amount to invest per auto-trade (calculates share quantity from price)
                </p>
                <Slider
                  value={[settings.autoTradePositionSize]}
                  min={100}
                  max={5000}
                  step={100}
                  className="mt-3"
                  onValueChange={([value]) => updateSettings.mutate({ autoTradePositionSize: value })}
                  data-testid="slider-auto-trade-position-size"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>$100</span>
                  <span>$5,000</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-risk-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Risk Management
          </CardTitle>
          <CardDescription>Set your risk tolerance and position sizing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-base">Risk Level</Label>
            <p className="text-sm text-muted-foreground mt-1 mb-2">
              Selecting a level applies predefined values to all settings below
            </p>
            <Select
              value={settings.riskLevel}
              onValueChange={(value) => {
                const preset = riskPresets[value];
                if (preset) {
                  updateSettings.mutate({ riskLevel: value, ...preset });
                  toast({
                    title: `Risk level set to ${value}`,
                    description: "All trading parameters have been updated to match.",
                  });
                } else {
                  updateSettings.mutate({ riskLevel: value });
                }
              }}
            >
              <SelectTrigger className="mt-2" data-testid="select-risk-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low - Conservative</SelectItem>
                <SelectItem value="medium">Medium - Balanced</SelectItem>
                <SelectItem value="medium-controlled">Medium & Controlled</SelectItem>
                <SelectItem value="buffett">Warren Buffett Style</SelectItem>
                <SelectItem value="high">High - Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Max Position Size</Label>
              <span className="text-sm font-medium" data-testid="text-position-size">${settings.maxPositionSize}</span>
            </div>
            <Slider
              value={[settings.maxPositionSize]}
              min={100}
              max={100000}
              step={100}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ maxPositionSize: value })}
              data-testid="slider-position-size"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>$100</span>
              <span>$100,000</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Stop Loss</Label>
              <span className="text-sm font-medium" data-testid="text-stop-loss">{settings.stopLossPercent}%</span>
            </div>
            <Slider
              value={[settings.stopLossPercent]}
              min={1}
              max={20}
              step={0.5}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ stopLossPercent: value })}
              data-testid="slider-stop-loss"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>1%</span>
              <span>20%</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Take Profit</Label>
              <span className="text-sm font-medium" data-testid="text-take-profit">{settings.takeProfitPercent}%</span>
            </div>
            <Slider
              value={[settings.takeProfitPercent]}
              min={2}
              max={100}
              step={1}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ takeProfitPercent: value })}
              data-testid="slider-take-profit"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>2%</span>
              <span>100%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-safety-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Trading Safety Guards
          </CardTitle>
          <CardDescription>
            Protections to prevent accidental or excessive trades
            {isLive && (
              <span className="text-red-500 font-medium ml-1">— Live trading active</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Max Order Value</Label>
              <span className="text-sm font-medium" data-testid="text-max-order-value">${settings.maxOrderValue.toLocaleString()}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Maximum estimated dollar value per individual order
            </p>
            <Slider
              value={[settings.maxOrderValue]}
              min={500}
              max={100000}
              step={500}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ maxOrderValue: value })}
              data-testid="slider-max-order-value"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>$500</span>
              <span>$100,000</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Daily Loss Limit</Label>
              <span className="text-sm font-medium" data-testid="text-max-daily-loss">${settings.maxDailyLoss.toLocaleString()}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Stop placing orders when daily losses exceed this amount
            </p>
            <Slider
              value={[settings.maxDailyLoss]}
              min={100}
              max={100000}
              step={100}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ maxDailyLoss: value })}
              data-testid="slider-max-daily-loss"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>$100</span>
              <span>$100,000</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Max Daily Orders</Label>
              <span className="text-sm font-medium" data-testid="text-max-daily-orders">{settings.maxDailyOrders}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Maximum number of orders per day
            </p>
            <Slider
              value={[settings.maxDailyOrders]}
              min={1}
              max={500}
              step={1}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ maxDailyOrders: value })}
              data-testid="slider-max-daily-orders"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>1</span>
              <span>500</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Max Equity Exposure</Label>
              <span className="text-sm font-medium" data-testid="text-max-equity-exposure">
                {settings.maxEquityExposure === 0 ? "Unlimited" : `${settings.maxEquityExposure}%`}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Cap total position exposure as a percentage of account equity. 0 = no cap.
            </p>
            <Slider
              value={[settings.maxEquityExposure]}
              min={0}
              max={300}
              step={10}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ maxEquityExposure: value })}
              data-testid="slider-max-equity-exposure"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Off</span>
              <span>300%</span>
            </div>
          </div>

          <div>
            <Label className="text-base">Allowed Symbols</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Restrict trading to specific symbols only. Comma-separated (e.g., AAPL,MSFT,GOOGL). Leave empty to allow all.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Input
                placeholder="AAPL,MSFT,GOOGL"
                value={symbolsInput}
                onChange={(e) => setSymbolsInput(e.target.value.toUpperCase())}
                data-testid="input-allowed-symbols"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateSettings.mutate({ allowedSymbols: symbolsInput })}
                data-testid="button-save-symbols"
              >
                Save
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Order Confirmation</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Show a review screen before submitting every order
              </p>
            </div>
            <Switch
              checked={settings.requireConfirmation}
              onCheckedChange={(checked) => updateSettings.mutate({ requireConfirmation: checked })}
              data-testid="switch-require-confirmation"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-api-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            API Connections
          </CardTitle>
          <CardDescription>Click any service to configure its connection</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div
              className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => setActiveDialog("ollama")}
            >
              <div className="flex flex-col">
                <span className="font-medium">Local AI (Ollama)</span>
                <span className="text-xs text-muted-foreground mt-0.5">
                  {apiKeyStatus?.ollamaModel || "deepseek-r1:70b"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Connected</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <div
              className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => setActiveDialog("alpaca")}
            >
              <div className="flex flex-col">
                <span className="font-medium">Alpaca Trading</span>
                <span className="text-xs text-muted-foreground mt-0.5">
                  {alpacaStatus?.connected ? (isLive ? "Live account" : "Paper trading") : "Not configured"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {alpacaStatus?.connected ? (
                  <>
                    {isLive && (
                      <Badge className="bg-red-500 hover:bg-red-600 text-white">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        LIVE
                      </Badge>
                    )}
                    <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Connected</Badge>
                  </>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not Connected</Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <div
              className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => setActiveDialog("finnhub")}
            >
              <div className="flex flex-col">
                <span className="font-medium">Finnhub Market Data</span>
                <span className="text-xs text-muted-foreground mt-0.5">
                  {apiKeyStatus?.finnhub ? "API key configured" : "Free key at finnhub.io"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {apiKeyStatus?.finnhub ? (
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not Connected</Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ApiKeyDialog
        service={activeDialog}
        open={activeDialog !== null}
        onOpenChange={(open) => { if (!open) setActiveDialog(null); }}
        currentStatus={apiKeyStatus}
      />
    </div>
  );
}
