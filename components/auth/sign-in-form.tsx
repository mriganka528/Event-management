"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Lock, LogIn, ShieldCheck } from "lucide-react";
import { beginSignInAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, nextRoute, type AuthActionState } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";

const initialState: AuthActionState = IDLE_AUTH_STATE;

/**
 * Step 1 of sign-in: email + password. The server decides whether a second
 * factor is required and redirects accordingly, so the client never decides
 * what the next step is.
 *
 * `nextRoute` covers every hand-off status, not just `verify`. A privileged
 * account that has cleared its password but has not enrolled a second factor is
 * answered with `activate`, and watching only for `verify` left that administrator
 * on a form that appeared to do nothing.
 */
export function SignInForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction, pending] = useActionState(beginSignInAction, initialState);
  const [email, setEmail] = useState("");

  useAuthToast(state);
  useEffect(() => {
    const next = nextRoute(state);
    if (next) window.location.assign(next);
  }, [state]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="returnTo" value={returnTo ?? ""} />

      <label className="grid gap-2 text-sm font-medium">
        Email address
        <Input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Password
        <PasswordInput name="password" autoComplete="current-password" required placeholder="Your password" />
      </label>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Checkbox name="rememberEmail" value="1" defaultChecked />
          Remember my email
        </label>
      </div>

      <AuthFeedback state={state} />

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
        Continue
      </Button>

      <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Administrators sign in with a one-time code sent to their email or phone after their password.
      </p>
      <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {email ? `Signed in as ${email}.` : "Up to 4 devices can be signed in at once."}
      </p>
    </form>
  );
}
