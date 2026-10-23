"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/**
 * Ends the provider session after the local one has already been cleared.
 *
 * `signOutAction` clears the HttpOnly local cookie and sends a customer here.
 * That matters because a customer holds two sessions: the local one this app
 * uses, and the Clerk one that actually authenticates them. Clearing only the
 * local session used to leave the Clerk session alive, so the next visit to
 * `/customer/auth/sign-in` was answered with "you are already signed in" and
 * the sign-in form never rendered.
 *
 * Clerk's session can only be ended from its own client, hence this screen. It
 * is deliberately not a form action: if the provider cannot be reached, the
 * local session is still gone, so the visitor gets an explicit way home rather
 * than being stuck on a spinner.
 */
export function CustomerSignOutPanel() {
  const clerk = useClerk();
  const started = useRef(false);
  const [status, setStatus] = useState<"waiting" | "manual">("waiting");

  useEffect(() => {
    if (!clerk.loaded || started.current) return;
    started.current = true;

    clerk.signOut({ redirectUrl: "/" }).catch(() => setStatus("manual"));
  }, [clerk]);

  // If Clerk's bundle or network never arrives, the local session has still been
  // revoked. Offer a way onward instead of leaving this screen spinning forever.
  useEffect(() => {
    const timer = window.setTimeout(() => setStatus("manual"), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  if (status === "manual") {
    return (
      <div className="space-y-4">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <LogOut className="h-7 w-7" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">You are signed out</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            We could not reach the sign-in provider to end its session too. You may still be signed in there, but
            this device no longer holds an account session.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/" className="w-full sm:w-auto">
            <Button className="w-full">Continue to home</Button>
          </Link>
          <Link href="/customer/auth/sign-in" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full">Try signing in again</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
        <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Signing you out…</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          We are ending your session here and with the sign-in provider, so the sign-in form is ready next time.
        </p>
      </div>
      <p className="flex items-start justify-center gap-2 text-xs text-[var(--muted)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        This only takes a moment.
      </p>
    </div>
  );
}
