"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isTheme, themeAreaForPath, themeStorageKey, type Theme } from "@/lib/theme-scope";

/**
 * Keeps `<html data-theme>` in step with the theme of the *current* area.
 *
 * Mounted once in the root layout, so it covers every route — including the
 * workspaces that render no toggle of their own (`/staff` and `/customer`).
 * Without it, walking from a dark admin panel to the customer dashboard would
 * leave the document wearing the admin area's theme, because the toggle that
 * applies it had just been unmounted.
 *
 * Runs after hydration, so the pre-paint bootstrap in `app/layout.tsx` is what
 * prevents any flash; this is only here to correct the value on navigation.
 */
export function ThemeScopeSync() {
  const pathname = usePathname();
  const area = themeAreaForPath(pathname);

  useEffect(() => {
    try {
      const key = themeStorageKey(area);
      let saved = window.localStorage.getItem(key);

      if (saved === null) {
        // Carry over the pre-scoped global preference once, for the public site.
        const legacy = window.localStorage.getItem("theme");
        if (isTheme(legacy)) {
          saved = legacy;
          window.localStorage.setItem(key, legacy);
        }
      }

      const next: Theme = isTheme(saved)
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

      if (document.documentElement.dataset.theme !== next) {
        document.documentElement.dataset.theme = next;
      }
    } catch {
      // Private mode or a storage-denied origin: the OS preference stands.
    }
  }, [area]);

  return null;
}