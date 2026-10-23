"use client";

import { Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  applyDocumentTheme,
  resolveTheme,
  themeAreaForPath,
  themeStorageKey,
  type Theme,
  type ThemeArea,
} from "@/lib/theme-scope";

const emptySubscribe = () => () => undefined;

/**
 * The theme stored for this area, falling back to the default.
 *
 * Deliberately never consults `prefers-color-scheme`. An unset preference used to
 * follow the operating system here and in the pre-paint bootstrap, which meant a
 * person on a dark-mode device was shown dark with no sign of who had chosen it
 * and no obvious way back. The default is light for everyone.
 */
function readStoredTheme(area: ThemeArea): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const { theme, migratedFrom } = resolveTheme(area, (key) => window.localStorage.getItem(key));
    // A value found under a retired key is folded into the current one, so the
    // migration happens once rather than on every visit.
    if (migratedFrom) window.localStorage.setItem(themeStorageKey(area), theme);
    return theme;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Theme switch, scoped to the area the visitor is currently in.
 *
 * Writes `theme:<area>`, so the customer journey — marketing pages, sign-in
 * panels, dashboard, booking form — and the admin and staff workspaces each keep
 * their own preference. Reading it back is keyed on the pathname, so navigating
 * from one area to the other shows that area's stored choice rather than the one
 * just clicked.
 */
export function ThemeToggle() {
  const pathname = usePathname();
  const area = themeAreaForPath(pathname);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
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
    applyDocumentTheme(document, theme);
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

  const visibleTheme = mounted ? theme : DEFAULT_THEME;
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