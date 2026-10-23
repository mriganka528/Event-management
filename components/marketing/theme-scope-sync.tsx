"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { applyDocumentTheme, resolveTheme, themeAreaForPath, themeStorageKey } from "@/lib/theme-scope";

/**
 * Keeps `<html data-theme>` in step with the theme of the *current* area.
 *
 * Mounted once in the root layout, so it covers every route. Without it, walking
 * from a dark admin panel to the customer booking form would leave the document
 * wearing the admin theme, because the toggle that applied it had just been
 * unmounted — the exact "my theme doesn't stick" symptom.
 *
 * Two themes means crossing an area boundary is now the common case rather than
 * the rare one, which is why this matters more than it used to: it is what makes
 * the customer journey and the workspaces visibly independent.
 *
 * Runs after hydration, so the pre-paint bootstrap in `app/layout.tsx` is what
 * prevents any flash; this only corrects the value on navigation.
 */
export function ThemeScopeSync() {
  const pathname = usePathname();
  const area = themeAreaForPath(pathname);

  useEffect(() => {
    try {
      const { theme, migratedFrom } = resolveTheme(area, (key) => window.localStorage.getItem(key));
      // Fold a preference found under a retired key into the current one, so the
      // migration happens once rather than on every navigation.
      if (migratedFrom) window.localStorage.setItem(themeStorageKey(area), theme);
      applyDocumentTheme(document, theme);
    } catch {
      // Private mode or a storage-denied origin: the default theme stands.
    }
  }, [area]);

  return null;
}