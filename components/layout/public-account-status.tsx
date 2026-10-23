"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AccountAccess, type AccountState } from "@/components/layout/account-access";
import { ACCOUNT_BOOTSTRAP_KEY, ACCOUNT_SIGNED_OUT_EVENT, type AccountBootstrapResponse } from "@/lib/account-bootstrap";

const SIGNED_OUT: AccountState = { name: null, roleLabel: null, workspaceHref: null };

/**
 * The visitor's account, for pages that are statically cached.
 *
 * The marketing pages render with a short `revalidate` window, so they cannot
 * read the session cookie on the server without giving up ISR on the primary
 * SEO surface. That single per-visitor fact is resolved in the browser instead.
 *
 * Held in a context so the desktop control and the small-screen menu share one
 * request rather than each firing their own on every page view.
 *
 * TIMING
 * ------
 * Waiting to fetch in an effect meant the request could not start until React
 * had hydrated, which cannot happen until the bundle has downloaded — so the
 * signed-out controls stayed up for the whole of that. The inline bootstrap in
 * the document head (see `lib/account-bootstrap.ts`) now issues the request
 * while the HTML is still being parsed, and the promise it leaves behind is
 * adopted here. By the time this mounts, the answer is usually already in.
 */
const PublicAccountContext = createContext<AccountState>(SIGNED_OUT);

export function usePublicAccount() {
  return useContext(PublicAccountContext);
}

/**
 * Keeps the header's account chip honest.
 *
 * A one-shot fetch was not enough. Sign-out is a Server Action, so Next.js can
 * answer it with a client-side navigation back to the same page; the header
 * never remounts and kept showing the previous visitor's chip. The provider now
 * re-asks whenever the route changes or the tab regains focus (which catches a
 * sign-in or sign-out made in another tab), and listens for the explicit
 * signed-out signal a sign-out form sends before submitting.
 *
 * A signed-out answer is *applied*, not ignored. The old effect returned early
 * for `{ signedIn: false }`, which left a stale signed-in chip in place after the
 * local session had gone.
 */
export function PublicAccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountState>(SIGNED_OUT);
  const pathname = usePathname();
  // The head bootstrap is only available to the first mounted page of a
  // document. Later paths are client navigations and need their own read.
  const consumedBootstrap = useRef(false);

  const apply = useCallback((data: AccountBootstrapResponse | null) => {
    // A network or endpoint failure leaves the last known state alone. Only a
    // real answer may change the chip: a decorative control must never flicker
    // or break because the header's endpoint had a bad moment.
    if (!data) return;
    if (!data.signedIn) {
      setAccount(SIGNED_OUT);
      return;
    }
    setAccount({
      name: data.name ?? null,
      roleLabel: data.roleLabel ?? null,
      workspaceHref: data.workspaceHref ?? null,
    });
  }, []);

  // Takes the request the head script left behind, if this document has one.
  // It is consumed on read so a later page of the same document cannot apply a
  // stale answer; those pages need a fresh request instead.
  const takeBootstrap = useCallback(() => {
    const bootstrap = window[ACCOUNT_BOOTSTRAP_KEY];
    if (!bootstrap) return null;
    delete window[ACCOUNT_BOOTSTRAP_KEY];
    return bootstrap;
  }, []);

  const readAccount = useCallback(
    (signal?: AbortSignal) =>
      fetch("/api/auth/whoami", {
        signal,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : null))
        .then(apply)
        .catch(() => undefined),
    [apply],
  );

  useEffect(() => {
    let cancelled = false;

    // First page of a fresh document: adopt the request the head script already
    // started, and drop it so it can never answer a later, stale question.
    if (!consumedBootstrap.current) {
      consumedBootstrap.current = true;
      const bootstrap = takeBootstrap();
      if (bootstrap) {
        bootstrap
          .then((data) => {
            if (!cancelled) apply(data);
          })
          .catch(() => undefined);
        return () => {
          cancelled = true;
        };
      }
    }

    // Every later page of the same document is reached by client navigation, so
    // there is no bootstrap left to adopt and a fresh read is taken. This is what
    // keeps the header honest after signing in or out elsewhere in the app.
    const controller = new AbortController();
    void readAccount(controller.signal);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pathname, apply, takeBootstrap, readAccount]);

  // A tab that was in the background may have missed a sign-in or sign-out in
  // another tab. Re-check when it is looked at again.
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void readAccount(controller.signal);
    };
    const onSignedOut = () => setAccount(SIGNED_OUT);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(ACCOUNT_SIGNED_OUT_EVENT, onSignedOut);

    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(ACCOUNT_SIGNED_OUT_EVENT, onSignedOut);
    };
  }, [readAccount]);

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
