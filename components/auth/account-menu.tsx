"use client";

import { LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";

/**
 * Presentational account chip.
 *
 * Deliberately a client component that takes plain props. The session lives in
 * an HttpOnly cookie and is resolved in a Server Component, so nothing about the
 * signed-in user is ever read on the client; this only renders what the server
 * already decided and posts the sign-out action.
 *
 * `formatRoleLabel` lives in `@/lib/role-label` rather than here: the layouts
 * that render this chip are Server Components, and anything exported from a
 * `"use client"` module throws when called from the server.
 */
export { formatRoleLabel } from "@/lib/role-label";
export function AccountMenu({ name, roleLabel, compact = false }: { name: string; roleLabel: string; compact?: boolean }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-dark)]"
          title={`${name} (${roleLabel})`}
          aria-hidden
        >
          {initial}
        </span>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-dark)]" aria-hidden>
        {initial}
      </span>
      <span className="hidden min-w-0 sm:block">
        <span className="block truncate text-sm font-medium text-[var(--foreground)]">{name}</span>
        <span className="block truncate text-xs capitalize text-[var(--muted)]">{roleLabel}</span>
      </span>
      <form action={signOutAction}>
        <Button type="submit" variant="outline" size="sm">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </form>
    </div>
  );
}
