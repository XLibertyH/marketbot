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
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, Shield, Gauge, Zap } from "lucide-react";
import type { BotSettings } from "@shared/schema";

export default function Settings() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<BotSettings>({
    queryKey: ["/api/settings"],
  });

  const updateSettings = useMutation({
    mutationFn: (data: Partial<BotSettings>) =>
      apiRequest("PATCH", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings updated" });
    },
  });

  if (isLoading || !settings) return null;

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
              <Label className="text-base">Simulation Mode</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Use mock market data for testing without real API keys
              </p>
            </div>
            <div className="flex items-center gap-3">
              {settings.simulationMode && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Active</Badge>
              )}
              <Switch
                checked={settings.simulationMode}
                onCheckedChange={(checked) => updateSettings.mutate({ simulationMode: checked })}
                data-testid="switch-simulation"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Auto-Trade</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically execute trades based on AI signals (requires live mode)
              </p>
            </div>
            <Switch
              checked={settings.autoTrade}
              disabled={settings.simulationMode}
              onCheckedChange={(checked) => updateSettings.mutate({ autoTrade: checked })}
              data-testid="switch-auto-trade"
            />
          </div>
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
            <Select
              value={settings.riskLevel}
              onValueChange={(value) => updateSettings.mutate({ riskLevel: value })}
            >
              <SelectTrigger className="mt-2" data-testid="select-risk-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low - Conservative</SelectItem>
                <SelectItem value="medium">Medium - Balanced</SelectItem>
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
              max={10000}
              step={100}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ maxPositionSize: value })}
              data-testid="slider-position-size"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>$100</span>
              <span>$10,000</span>
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
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base">Take Profit</Label>
              <span className="text-sm font-medium" data-testid="text-take-profit">{settings.takeProfitPercent}%</span>
            </div>
            <Slider
              value={[settings.takeProfitPercent]}
              min={2}
              max={50}
              step={1}
              className="mt-3"
              onValueChange={([value]) => updateSettings.mutate({ takeProfitPercent: value })}
              data-testid="slider-take-profit"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-api-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            API Connection Status
          </CardTitle>
          <CardDescription>Status of external service connections</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="font-medium">OpenAI (AI Analysis)</span>
              <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Connected</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="font-medium">Alpaca (Trading)</span>
              <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                {settings.simulationMode ? "Mock Mode" : "Not Connected"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="font-medium">Finnhub (News)</span>
              <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                {settings.simulationMode ? "Mock Mode" : "Not Connected"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
