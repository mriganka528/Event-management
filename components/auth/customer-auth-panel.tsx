"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  ClerkDegraded,
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useUser,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

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
 * When a Clerk session is already live, it says so and offers to continue with
 * it or to use a different account, rather than bouncing the visitor silently.
 * Both of those choices show their own progress state.
 *
 * Customer sign-out itself also ends the Clerk session (through
 * `/customer/auth/sign-out`), so this branch is the recovery path for a session
 * that outlived a local sign-out or was started in another tab.
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
  const clerk = useClerk();
  const [switching, setSwitching] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // A Clerk session is still live, so the form would never render — Clerk
  // would redirect away the moment it mounted. Say so and offer the way out.
  if (isLoaded && isSignedIn) {
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
    const name = user?.fullName?.trim() || user?.username || "Customer account";
    const busy = switching || continuing;
    // Both actions share the same box, type scale, and border width. The primary
    // gets a transparent border so the 1px outline on the secondary button does
    // not make their text sit at different positions.
    const actionButtonClass =
      "h-9 min-h-9 w-full justify-center gap-2 whitespace-nowrap border px-4 py-0 text-xs font-medium leading-4";

    return (
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--card)] shadow-sm"
        aria-label="Signed-in customer account"
        aria-busy={busy || undefined}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--brand-softer)] px-4 py-3.5 sm:px-6">
          <p className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-dark)]">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Active session</span>
          </p>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--success-text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success-text)]" aria-hidden="true" />
            Signed in
          </span>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--brand-soft)] text-lg font-semibold text-[var(--brand-dark)]">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Customer account
              </p>
              <p className="mt-0.5 truncate text-lg font-semibold text-[var(--foreground)]">{name}</p>
              {email ? (
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-all">{email}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-medium text-[var(--foreground)]">You&apos;re already signed in</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              Continue to your dashboard to manage bookings and invoices, or switch accounts if you meant to use a
              different one.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <form
              action="/customer/auth/complete"
              method="get"
              className="m-0 w-full p-0"
              onSubmit={(event) => {
                // A full document load is intentional: the completion route hands
                // off to the session-exchange endpoint, which mints the cookie and
                // redirects. A client-side push cannot perform that exchange.
                if (busy) {
                  event.preventDefault();
                  return;
                }
                setContinuing(true);
              }}
            >
              <Button
                type="submit"
                size="sm"
                disabled={busy}
                aria-busy={continuing || undefined}
                className={`${actionButtonClass} border-transparent`}
              >
                {continuing ? (
                  <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <LayoutDashboard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{continuing ? "Opening your dashboard…" : "Continue to dashboard"}</span>
              </Button>
            </form>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-busy={switching || undefined}
              className={actionButtonClass}
              onClick={() => {
                if (busy) return;
                setSwitchError(null);
                setSwitching(true);
                clerk.signOut({ redirectUrl: path }).catch(() => {
                  // The provider did not answer, so the session may still be live.
                  // Release the button and explain, rather than sending the visitor
                  // to a page that would only bounce them back here.
                  setSwitching(false);
                  setSwitchError("We couldn't sign you out just now. Please try again.");
                });
              }}
            >
              {switching ? (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{switching ? "Signing you out…" : "Use a different account"}</span>
            </Button>
          </div>

          {switchError ? (
            <p role="alert" className="rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-center text-xs font-medium text-[var(--danger-text)]">
              {switchError}
            </p>
          ) : null}

          <p className="flex items-start justify-center gap-2 text-center text-xs leading-5 text-[var(--muted)]">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Switching accounts signs you out of this session first.
          </p>
        </div>
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

/** One or two initials for the avatar, whether we were given a name or an address. */
function initials(value: string): string {
  const words = value
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
