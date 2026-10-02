"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const emptySubscribe = () => () => undefined;

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
  }, [mounted, theme]);

  const visibleTheme = mounted ? theme : "light";

  return (
    <button
      type="button"
      onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] sm:px-4"
      aria-label={`Switch to ${visibleTheme === "light" ? "dark" : "light"} theme`}
      title={`Switch to ${visibleTheme === "light" ? "dark" : "light"} theme`}
    >
      {visibleTheme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="hidden sm:inline">{visibleTheme === "light" ? "Dark" : "Light"}</span>
    </button>
  );
}
