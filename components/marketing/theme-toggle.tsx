"use client";

import { Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { isTheme, themeAreaForPath, themeStorageKey, type Theme } from "@/lib/theme-scope";

const emptySubscribe = () => () => undefined;

function readStoredTheme(area: Parameters<typeof themeStorageKey>[0]): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(themeStorageKey(area));
    if (isTheme(saved)) return saved;
    // First visit to this area: follow the operating system, exactly as the
    // pre-paint bootstrap does, so the button never disagrees with the page.
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Theme switch, scoped to the area the visitor is currently in.
 *
 * Writes `theme:<area>`, so the customer area, the staff area, the admin panel,
 * and the public site each keep their own preference. Reading it back is keyed
 * on the pathname, so navigating from one area to another shows that area's
 * stored choice rather than the one just clicked.
 */
export function ThemeToggle() {
  const pathname = usePathname();
  const area = themeAreaForPath(pathname);
  const [theme, setTheme] = useState<Theme>("light");
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  // Re-read whenever the area changes. Declared after the `useState` initialiser
  // so the first client render matches the server and hydration stays quiet; the
  // value is corrected immediately afterwards.
  useEffect(() => {
    setTheme(readStoredTheme(area));
  }, [area]);

  // Apply on change *and* on area change, so the switch repaints instantly
  // rather than waiting for the next render.
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.theme = theme;
  }, [mounted, theme, area]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(themeStorageKey(area), next);
      } catch {
        // Storage unavailable: the theme still applies for this page view.
      }
      return next;
    });
  }, [area]);

  const visibleTheme = mounted ? theme : "light";
  const label = visibleTheme === "light" ? "Dark" : "Light";

  return (
    <button
      type="button"
      onClick={toggle}
      // The area is named so it is unambiguous which preference is being changed
      // now that each area has its own.
      title={`Switch to ${label.toLowerCase()} theme for the ${area} area`}
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] sm:px-4"
    >
      {visibleTheme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only">{`Switch to ${label.toLowerCase()} theme for the ${area} area`}</span>
    </button>
  );
}