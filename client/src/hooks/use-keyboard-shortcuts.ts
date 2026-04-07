import { useEffect } from "react";
import { useLocation } from "wouter";
import { useTheme } from "@/components/theme-provider";

const NAV_PATHS = ["/", "/trading", "/watchlist", "/signals", "/news", "/ai-mind", "/settings"];

export function useKeyboardShortcuts() {
  const [, setLocation] = useLocation();
  const { toggleTheme } = useTheme();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Cmd+1-7: Navigate
      if (e.key >= "1" && e.key <= "7") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < NAV_PATHS.length) {
          setLocation(NAV_PATHS[idx]);
        }
      }

      // Cmd+D: Toggle dark mode
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        toggleTheme();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setLocation, toggleTheme]);
}
