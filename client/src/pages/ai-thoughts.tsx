/**
 * AI Mind — Live view of deepseek-r1's continuous market reasoning
 *
 * Shows the AI's raw chain-of-thought (<think> blocks) alongside
 * its final conclusions, so the user can watch the model work
 * through market data in real time.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Loader2, Zap, Clock, ChevronDown, ChevronRight,
  TrendingUp, Newspaper, BarChart2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────

interface DataSnapshot {
  buzzTickerCount: number;
  topBuzzTickers: string[];
  newsCount: number;
  recentHeadlines: string[];
  watchlistSymbols: string[];
  signalSummary: { buy: number; sell: number; hold: number };
  marketSentimentAvg: number;
}

interface AIThought {
  id: number;
  timestamp: string;
  status: "thinking" | "complete" | "error";
  dataSnapshot: DataSnapshot;
  thinking: string;
  conclusion: string;
  durationMs: number;
  error?: string;
}

interface ThinkingStatus {
  isThinking: boolean;
  thoughtCount: number;
  nextThinkAt: string | null;
  intervalMinutes: number;
}

interface AIThoughtsResponse {
  thoughts: AIThought[];
  status: ThinkingStatus;
}

// ── Helpers ───────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

function sentimentColor(avg: number): string {
  if (avg > 0.15) return "text-emerald-600";
  if (avg < -0.15) return "text-red-500";
  return "text-amber-600";
}

/** Lightweight markdown → JSX for AI conclusions */
function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushList() {
    if (listItems.length === 0) return;
    const Tag = listOrdered ? "ol" : "ul";
    elements.push(
      <Tag key={elements.length} className={`${listOrdered ? "list-decimal" : "list-disc"} pl-5 space-y-1 my-2 text-sm text-foreground/90`}>
        {listItems.map((li, i) => <li key={i}><InlineFormat text={li} /></li>)}
      </Tag>
    );
    listItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Headings
    const h3 = trimmed.match(/^###\s+(.*)/);
    if (h3) { flushList(); elements.push(<h4 key={i} className="font-semibold text-sm mt-4 mb-1 text-foreground">{h3[1].replace(/\*\*/g, "")}</h4>); continue; }
    const h2 = trimmed.match(/^##\s+(.*)/);
    if (h2) { flushList(); elements.push(<h3 key={i} className="font-bold text-base mt-4 mb-1 text-foreground">{h2[1].replace(/\*\*/g, "")}</h3>); continue; }

    // Numbered list
    const ol = trimmed.match(/^\d+\.\s+(.*)/);
    if (ol) {
      if (!listOrdered && listItems.length > 0) flushList();
      listOrdered = true;
      listItems.push(ol[1]);
      continue;
    }

    // Bullet list
    const ul = trimmed.match(/^[-•]\s+(.*)/);
    if (ul) {
      if (listOrdered && listItems.length > 0) flushList();
      listOrdered = false;
      listItems.push(ul[1]);
      continue;
    }

    flushList();

    // Horizontal rule
    if (/^---+$/.test(trimmed)) { elements.push(<hr key={i} className="my-3 border-border/50" />); continue; }

    // Empty line
    if (trimmed === "") { continue; }

    // Paragraph
    elements.push(<p key={i} className="text-sm leading-relaxed text-foreground/90 mb-2"><InlineFormat text={trimmed} /></p>);
  }
  flushList();

  return <div>{elements}</div>;
}

/** Inline bold/ticker formatting */
function InlineFormat({ text }: { text: string }) {
  // Split on **bold** markers
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          const inner = part.slice(2, -2);
          // Ticker-like bold (all caps, short) gets a special style
          if (/^[A-Z]{1,5}$/.test(inner)) {
            return <span key={i} className="font-bold text-primary">{inner}</span>;
          }
          return <strong key={i} className="font-semibold text-foreground">{inner}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── ThinkingCard ──────────────────────────────────────────────

function ThinkingCard({ thought }: { thought: AIThought }) {
  const [showThinking, setShowThinking] = useState(false);
  const snap = thought.dataSnapshot;

  if (thought.status === "thinking") {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/15">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-primary">AI is thinking…</CardTitle>
              <CardDescription className="text-xs">deepseek-r1 is analysing market data</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (thought.status === "error") {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-red-600">Analysis failed</span>
            <span className="ml-auto text-xs text-muted-foreground">{timeAgo(thought.timestamp)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-red-500">{thought.error || "Unknown error"}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 hover:border-primary/30 transition-colors">
      {/* ── Header ── */}
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-emerald-500/10 shrink-0 mt-0.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold">Analysis Complete</CardTitle>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {formatDuration(thought.durationMs)}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(thought.timestamp)}</span>
            </div>
            {/* Data snapshot badges */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {snap.watchlistSymbols.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                  <BarChart2 className="h-2.5 w-2.5" />
                  {snap.watchlistSymbols.length} stocks
                </Badge>
              )}
              {snap.newsCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                  <Newspaper className="h-2.5 w-2.5" />
                  {snap.newsCount} news
                </Badge>
              )}
              {snap.buzzTickerCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-orange-500/10 text-orange-600">
                  🔥 {snap.buzzTickerCount} buzz
                </Badge>
              )}
              {(snap.signalSummary.buy + snap.signalSummary.sell + snap.signalSummary.hold) > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                  <Zap className="h-2.5 w-2.5" />
                  {snap.signalSummary.buy}B / {snap.signalSummary.sell}S / {snap.signalSummary.hold}H
                </Badge>
              )}
              {snap.marketSentimentAvg !== 0 && (
                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 gap-1 ${sentimentColor(snap.marketSentimentAvg)}`}>
                  <TrendingUp className="h-2.5 w-2.5" />
                  Sentiment {snap.marketSentimentAvg > 0 ? "+" : ""}{snap.marketSentimentAvg}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Conclusion ── */}
        {thought.conclusion && (
          <div className="max-w-none">
            <MarkdownContent text={thought.conclusion} />
          </div>
        )}

        {/* ── Chain of Thought Toggle ── */}
        {thought.thinking && (
          <div>
            <button
              onClick={() => setShowThinking(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showThinking ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showThinking ? "Hide" : "Show"} chain-of-thought ({Math.round(thought.thinking.length / 4)} tokens est.)
            </button>
            {showThinking && (
              <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border/40 max-h-96 overflow-y-auto">
                <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono break-words">
                  {thought.thinking}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── StatusBar ─────────────────────────────────────────────────

function StatusBar({ status, onTrigger, isTriggering }: {
  status: ThinkingStatus;
  onTrigger: () => void;
  isTriggering: boolean;
}) {
  const nextAt = status.nextThinkAt ? new Date(status.nextThinkAt) : null;
  const msUntil = nextAt ? nextAt.getTime() - Date.now() : null;
  const minutesUntil = msUntil !== null ? Math.max(0, Math.ceil(msUntil / 60000)) : null;

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/40 border border-border/50">
      <div className={`p-2 rounded-full ${status.isThinking ? "bg-primary/15" : "bg-emerald-500/10"}`}>
        <Brain className={`h-5 w-5 ${status.isThinking ? "text-primary animate-pulse" : "text-emerald-500"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {status.isThinking ? "Thinking now…" : "Continuous analysis active"}
          </span>
          {status.isThinking && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground">
            {status.thoughtCount} session{status.thoughtCount !== 1 ? "s" : ""} completed
          </span>
          {!status.isThinking && minutesUntil !== null && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Next in {minutesUntil}m
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Every {status.intervalMinutes}min
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onTrigger}
        disabled={status.isThinking || isTriggering}
        className="shrink-0"
      >
        {isTriggering || status.isThinking ? (
          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Thinking</>
        ) : (
          <><Zap className="h-3.5 w-3.5 mr-1.5" /> Think Now</>
        )}
      </Button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function AIThoughts() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AIThoughtsResponse>({
    queryKey: ["/api/ai-thoughts"],
    queryFn: async () => {
      const res = await fetch("/api/ai-thoughts?limit=20");
      if (!res.ok) throw new Error("Failed to fetch AI thoughts");
      return res.json();
    },
    refetchInterval: 15000, // poll every 15s to catch new thoughts
  });

  const trigger = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/ai-thoughts/trigger");
    },
    onSuccess: (data: any) => {
      if (data.ok === false) {
        toast({ title: "Already thinking", description: data.message, variant: "default" });
      } else {
        toast({ title: "Thinking triggered", description: "deepseek-r1 is now analysing the market…" });
        // Refresh after a short delay
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/ai-thoughts"] }), 1500);
      }
    },
    onError: () => {
      toast({ title: "Failed to trigger", description: "Could not start a thinking session", variant: "destructive" });
    },
  });

  const thoughts = data?.thoughts || [];
  const status = data?.status || { isThinking: false, thoughtCount: 0, nextThinkAt: null, intervalMinutes: 4 };

  return (
    <div className="space-y-6" data-testid="ai-thoughts-page">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            AI Mind
          </h1>
          <p className="text-muted-foreground mt-1">
            deepseek-r1 thinks out loud about the market — continuously, in real time
          </p>
        </div>
        <Badge variant="outline" className="text-xs mt-1">
          {status.thoughtCount} session{status.thoughtCount !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Status Bar */}
      <StatusBar
        status={status}
        onTrigger={() => trigger.mutate()}
        isTriggering={trigger.isPending}
      />

      {/* Thoughts Feed */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-32 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : thoughts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Brain className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium">No analysis sessions yet</p>
            <p className="text-sm mt-1">The AI will start thinking in about 30 seconds after startup.</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => trigger.mutate()}
              disabled={trigger.isPending}
            >
              <Zap className="h-4 w-4 mr-2" />
              Trigger First Session
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {thoughts.map(thought => (
            <ThinkingCard key={thought.id} thought={thought} />
          ))}
        </div>
      )}
    </div>
  );
}
