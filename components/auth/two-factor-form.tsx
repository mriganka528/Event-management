"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { completeSignInAction, resendTwoFactorAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, nextRoute } from "@/components/auth/auth-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Second-factor screen. Reached only after a correct password, and it grants
 * nothing on its own: the server still issues the session only after the code
 * verifies.
 */
export function TwoFactorForm({ channel, returnTo }: { channel: "email" | "phone"; returnTo?: string }) {
  const [state, formAction, pending] = useActionState(completeSignInAction, IDLE_AUTH_STATE);
  const [resendState, resendAction, resending] = useActionState(resendTwoFactorAction, IDLE_AUTH_STATE);
  const [code, setCode] = useState("");

  useEffect(() => {
    const next = nextRoute(state);
    if (next) window.location.assign(next);
  }, [state]);

  const destination = state.maskedDestination ?? resendState.maskedDestination;

  return (
    <div className="grid gap-5">
      <form action={formAction} className="grid gap-4">
        <input type="hidden" name="returnTo" value={returnTo ?? ""} />

        <label className="grid gap-2 text-sm font-medium">
          6-digit code
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="text-center text-2xl font-semibold tracking-[0.4em]"
          />
        </label>

        <AuthFeedback state={state} />

        <Button type="submit" disabled={pending || code.length !== 6}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
          Verify and continue
        </Button>
      </form>

      <div className="border-t border-[var(--line)] pt-4">
        <form action={resendAction} className="grid gap-3">
          <AuthFeedback state={resendState} tone="info" />
          <Button type="submit" variant="ghost" size="sm" disabled={resending} className="justify-self-start">
            <RefreshCw className={`mr-2 h-4 w-4 ${resending ? "animate-spin" : ""}`} />
            Send a new code
          </Button>
        </form>
      </div>

      <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {channel === "phone" ? (
          <>A code was sent by SMS{destination ? ` to ${destination}` : ""}. It expires in 10 minutes and can only be used once.</>
        ) : (
          <>A code was emailed{destination ? ` to ${destination}` : ""}. It expires in 10 minutes and can only be used once.</>
        )}
      </p>
    </div>
  );
}
