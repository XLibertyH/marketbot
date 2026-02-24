import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Watchlist from "@/pages/watchlist";
import Signals from "@/pages/signals";
import News from "@/pages/news";
import Trading from "@/pages/trading";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";
import {
  LayoutDashboard, List, Zap, Newspaper, Settings as SettingsIcon, Bot, LineChart,
} from "lucide-react";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/trading", label: "Trading", icon: LineChart },
  { path: "/watchlist", label: "Watchlist", icon: List },
  { path: "/signals", label: "Signals", icon: Zap },
  { path: "/news", label: "News", icon: Newspaper },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];

function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="hidden md:flex w-[240px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground" data-testid="sidebar">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-sidebar-border">
        <div className="p-1.5 rounded-lg bg-primary text-primary-foreground">
          <Bot className="h-5 w-5" />
        </div>
        <span className="font-bold text-lg tracking-tight">TradeBot AI</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location === path || (path !== "/" && location.startsWith(path));
          return (
            <Link key={path} href={path}>
              <div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`}
                data-testid={`nav-${label.toLowerCase()}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-sidebar-border">
        <p className="text-xs text-sidebar-foreground/50">
          Simulation Mode Active
        </p>
      </div>
    </aside>
  );
}

function MobileNav() {
  const [location] = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-sidebar border-t border-sidebar-border z-50 flex" data-testid="mobile-nav">
      {navItems.map(({ path, label, icon: Icon }) => {
        const isActive = location === path || (path !== "/" && location.startsWith(path));
        return (
          <Link key={path} href={path} className="flex-1">
            <div className={`flex flex-col items-center py-2 text-xs ${isActive ? "text-primary" : "text-muted-foreground"}`}>
              <Icon className="h-5 w-5 mb-0.5" />
              {label}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/trading" component={Trading} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/signals" component={Signals} />
      <Route path="/news" component={News} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
            <div className="p-6">
              <Router />
            </div>
          </main>
          <MobileNav />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
