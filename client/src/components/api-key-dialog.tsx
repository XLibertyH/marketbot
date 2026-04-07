import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";

type Service = "ollama" | "alpaca" | "finnhub";

interface ApiKeyDialogProps {
  service: Service | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus?: Record<string, any>;
}

const serviceConfig = {
  ollama: {
    title: "Local AI (Ollama)",
    description: "Configure the connection to your local Ollama instance running deepseek-r1.",
    fields: [
      { key: "OLLAMA_BASE_URL", label: "Base URL", placeholder: "http://localhost:11434/v1", type: "text" as const },
      { key: "OLLAMA_MODEL", label: "Model Name", placeholder: "deepseek-r1:70b", type: "text" as const },
    ],
  },
  alpaca: {
    title: "Alpaca Trading",
    description: "Connect your Alpaca paper or live trading account. Get free API keys at alpaca.markets",
    fields: [
      { key: "ALPACA_API_KEY", label: "API Key", placeholder: "PK...", type: "password" as const },
      { key: "ALPACA_SECRET_KEY", label: "Secret Key", placeholder: "Your secret key", type: "password" as const },
      { key: "ALPACA_BASE_URL", label: "Base URL (optional)", placeholder: "https://paper-api.alpaca.markets", type: "text" as const },
    ],
  },
  finnhub: {
    title: "Finnhub Market Data",
    description: "Get real-time stock quotes and news. Free API key at finnhub.io (60 calls/min).",
    fields: [
      { key: "FINNHUB_API_KEY", label: "API Key", placeholder: "Your Finnhub API key", type: "password" as const },
    ],
  },
};

export function ApiKeyDialog({ service, open, onOpenChange, currentStatus }: ApiKeyDialogProps) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<{ connected: boolean; details?: string; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!service) return null;

  const config = serviceConfig[service];

  const handleSave = async () => {
    const entries = config.fields
      .filter(f => values[f.key] !== undefined && values[f.key] !== "")
      .map(f => ({ key: f.key, value: values[f.key] }));
    if (entries.length === 0) return;

    setSaving(true);
    try {
      for (const entry of entries) {
        await apiRequest("PUT", "/api/api-keys", entry);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys/status"] });
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setTestResult({ connected: false, error: err.message || "Save failed" });
    }
    setSaving(false);
  };

  const handleTest = async () => {
    // Save first if there are values, then test
    const entries = config.fields
      .filter(f => values[f.key] !== undefined && values[f.key] !== "")
      .map(f => ({ key: f.key, value: values[f.key] }));
    if (entries.length > 0) {
      for (const entry of entries) {
        await apiRequest("PUT", "/api/api-keys", entry);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys/status"] });
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/api-keys/test", { service });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ connected: false, error: err.message || "Test failed" });
    }
    setTesting(false);
  };

  const getPlaceholder = (field: typeof config.fields[0]) => {
    if (field.key === "OLLAMA_BASE_URL" && currentStatus?.ollamaUrl) return currentStatus.ollamaUrl;
    if (field.key === "OLLAMA_MODEL" && currentStatus?.ollamaModel) return currentStatus.ollamaModel;
    return field.placeholder;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {config.fields.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <div className="relative">
                <Input
                  id={field.key}
                  type={field.type === "password" && !showFields[field.key] ? "password" : "text"}
                  placeholder={getPlaceholder(field)}
                  value={values[field.key] || ""}
                  onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="pr-10"
                />
                {field.type === "password" && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowFields(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                  >
                    {showFields[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {testResult && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.connected ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
              {testResult.connected ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              <span>{testResult.connected ? testResult.details || "Connected" : testResult.error || "Connection failed"}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test Connection
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
