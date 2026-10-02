"use client";

import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Lock, LogIn, ShieldCheck } from "lucide-react";
import { beginSignInAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, nextRoute, type AuthActionState } from "@/components/auth/auth-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");

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
        <span className="relative block">
          <Input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="pr-11"
            placeholder="Your password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
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
