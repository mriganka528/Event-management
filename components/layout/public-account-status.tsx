"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { AccountAccess, type AccountState } from "@/components/layout/account-access";

const SIGNED_OUT: AccountState = { name: null, roleLabel: null, workspaceHref: null };

/**
 * The visitor's account, for pages that are statically cached.
 *
 * The marketing pages render with a short `revalidate` window, so they cannot
 * read the session cookie on the server without giving up ISR on the primary
 * SEO surface. That single per-visitor fact is resolved in the browser after
 * hydration instead.
 *
 * Held in a context so the desktop control and the small-screen menu share one
 * request rather than each firing their own on every page view.
 */
const PublicAccountContext = createContext<AccountState>(SIGNED_OUT);

export function usePublicAccount() {
  return useContext(PublicAccountContext);
}

/** Wraps the header in the provider and performs the one fetch. */
export function PublicAccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountState>(SIGNED_OUT);

  useEffect(() => {
    // Aborted on unmount so a fast navigation does not leave a response handler
    // running against a tree that is gone.
    const controller = new AbortController();

    fetch("/api/auth/whoami", {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (data: { signedIn?: boolean; name?: string | null; roleLabel?: string | null; workspaceHref?: string | null } | null) => {
          if (!data?.signedIn) return;
          setAccount({
            name: data.name ?? null,
            roleLabel: data.roleLabel ?? null,
            workspaceHref: data.workspaceHref ?? null,
          });
        },
      )
      .catch(() => {
        // Offline, aborted, or the endpoint failed. The signed-out controls stay
        // put — a decorative chip must never break the header.
      });

    return () => controller.abort();
  }, []);

  return createElement(PublicAccountContext.Provider, { value: account }, children);
}

/**
 * Session-aware account control.
 *
 * The signed-out buttons render immediately rather than behind a spinner: they
 * are the correct default for most traffic on a marketing page, and it means the
 * header is never empty. A visitor who does hold a session gets the chip
 * replaced as soon as the answer arrives.
 */
export function PublicAccountStatus() {
  const account = usePublicAccount();
  return <AccountAccess {...account} />;
}