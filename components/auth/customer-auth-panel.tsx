"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle, Mail, RefreshCw, ShieldAlert } from "lucide-react";
import {
  ClerkDegraded,
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  SignIn,
  SignUp,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { nextRoute } from "@/components/auth/action-state";

/**
 * The Clerk-rendered half of the customer sign-in and sign-up screens.
 *
 * Two things used to go wrong here, and both showed up as "the sign-in page
 * does not show":
 *
 *  - The form is rendered by Clerk's client bundle, which is not on the page
 *    until it downloads. `<SignIn>` renders nothing while it boots, so the
 *    server-rendered page was a heading and a blank gap. That gap is the whole
 *    page when the bundle is slow or blocked by an ad-blocker, and there was
 *    no message saying so.
 *
 *  - A customer who had signed in with Clerk before still had a Clerk session
 *    cookie in the browser, even after signing out of this app — the local
 *    sign-out only revoked the local session. Clerk's `<SignIn>` then saw
 *    `isSignedIn` and redirected away immediately, so the form never appeared
 *    at all.
 *
 * This component owns both problems. It shows a skeleton while Clerk boots, a
 * form once it has, and a real error state with a retry when it never arrives.
 * When a Clerk session is already live, it finishes the hand-off automatically
 * and shows a signing-in state while the local session is minted and the
 * dashboard loads. The customer is never left on a "welcome back" screen with a
 * button to press.
 *
 * Customer sign-out itself also ends the Clerk session (through
 * `/customer/auth/sign-out`), so a provider session seen here is one that was
 * started in another tab, survived a local sign-out, or has just been created
 * by the sign-in code the customer entered.
 */
export function CustomerAuthPanel({
  mode,
  path,
  signInUrl,
  signUpUrl,
  fallbackRedirectUrl,
}: {
  mode: "sign-in" | "sign-up";
  path: string;
  signInUrl?: string;
  signUpUrl?: string;
  fallbackRedirectUrl: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const signedIn = isLoaded && isSignedIn;
  const redirectStarted = useRef(false);

  /**
   * A provider session means the visitor is already authenticated; the only
   * thing left is to exchange it for the local session the rest of the
   * application understands.
   *
   * This used to render an "Active session" card and wait for a button. That is
   * what customers saw after entering the email code: the "Welcome back" page
   * appeared again, with buttons, until they pressed "Continue to dashboard".
   * Finish the hand-off automatically instead, and use the wait to show a clear
   * signing-in state.
   *
   * `window.location.replace` is intentional rather than a client-side push:
   * the completion route is answered at the edge by the session-exchange
   * endpoint, which mints the cookie and redirects to the workspace. A
   * client-side transition cannot perform that exchange. Replacing the entry
   * also keeps the credential screen out of the back-button history.
   */
  useEffect(() => {
    if (!signedIn || redirectStarted.current) return;
    // A provider session is a completed auth hand-off, so it follows the same
    // route decision as every first-party credential form.
    const next = nextRoute({ status: "done", next: fallbackRedirectUrl });
    if (!next) return;
    redirectStarted.current = true;
    window.location.replace(next);
  }, [signedIn, fallbackRedirectUrl]);

  // A live provider session is on its way to the dashboard, so the form must
  // not flash back into view while the exchange is in progress.
  if (signedIn) {
    const name = user?.firstName?.trim() || user?.fullName?.trim() || user?.username || "";
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;

    return (
      <section
        className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 text-center shadow-sm sm:p-8"
        aria-label="Signing in to your customer account"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
        </span>
        <p className="mt-4 text-lg font-semibold text-[var(--foreground)]">
          Welcome back{name ? `, ${name}` : ""}
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]" role="status">
          Signing you in and opening your dashboard…
        </p>
        {email ? (
          <p className="mt-3 flex min-w-0 items-center justify-center gap-1.5 text-xs text-[var(--muted)]">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="break-all">{email}</span>
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <ClerkLoading>
        <FormSkeleton label={mode === "sign-in" ? "Loading the sign-in form…" : "Loading the sign-up form…"} />
      </ClerkLoading>

      <ClerkFailed>
        <div className="rounded-[28px] border border-[var(--danger-soft)] bg-[var(--card)] p-5 text-center shadow-sm sm:p-6">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger-text)]">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </span>
          <p className="mt-3 font-semibold text-[var(--danger-text)]">The sign-in form could not be loaded.</p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            This can happen when the page is blocked by a browser extension or a slow connection. Please reload and
            try again.
          </p>
          <Button type="button" variant="outline" className="mt-4 w-full sm:w-auto" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reload page
          </Button>
        </div>
      </ClerkFailed>

      <ClerkDegraded>
        <p className="rounded-2xl border border-[var(--warning-soft)] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-5 text-[var(--warning-text)]">
          The sign-in service is running in a reduced mode. If the form does not appear, please try again later.
        </p>
      </ClerkDegraded>

      <ClerkLoaded>
        {mode === "sign-in" ? (
          <SignIn
            routing="path"
            path={path}
            signUpUrl={signUpUrl}
            forceRedirectUrl={fallbackRedirectUrl}
            fallbackRedirectUrl={fallbackRedirectUrl}
            fallback={<FormSkeleton label="Preparing the sign-in form…" />}
          />
        ) : (
          <SignUp
            routing="path"
            path={path}
            signInUrl={signInUrl}
            forceRedirectUrl={fallbackRedirectUrl}
            fallbackRedirectUrl={fallbackRedirectUrl}
            fallback={<FormSkeleton label="Preparing the sign-up form…" />}
          />
        )}
      </ClerkLoaded>
    </>
  );
}

/** The same shape as the form, so nothing jumps when Clerk replaces it. */
function FormSkeleton({ label }: { label: string }) {
  return (
    <div
      className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm sm:p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--foreground)]">Connecting securely</p>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{label}</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-[var(--surface-muted)]" />
        <div className="h-11 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-[var(--surface-muted)]" />
        <div className="h-11 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
        <div className="h-11 animate-pulse rounded-full bg-[var(--surface-muted)]" />
      </div>
    </div>
  );
}
