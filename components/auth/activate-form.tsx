"use client";

import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, UserCheck } from "lucide-react";
import { activateAccountAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, nextRoute } from "@/components/auth/auth-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/auth/field-error";

/**
 * Consumes a single-use activation link and sets the first password.
 *
 * The action hands off with `activate`: a privileged account goes on to enrol a
 * second factor, everyone else returns to the sign-in form. Without following
 * that status the form simply re-rendered after a successful password change.
 */
export function ActivateForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(activateAccountAction, IDLE_AUTH_STATE);
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState("");
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    const next = nextRoute(state);
    if (next) window.location.assign(next);
  }, [state]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />

      <p className="rounded-2xl border border-[var(--line)] bg-[var(--card-elevated)] px-4 py-3 text-sm text-[var(--muted-strong)]">
        Setting a password for <span className="font-semibold text-[var(--foreground)]">{email}</span>
      </p>

      <label className="grid gap-2 text-sm font-medium">
        New password
        <span className="relative block">
          <Input
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="new-password"
            className="pr-11"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label={show ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
        <span className="text-xs text-[var(--muted)]">At least 12 characters with upper case, lower case, a number, and a symbol.</span>
        <FieldError message={errors.password} />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Confirm password
        <Input name="confirmPassword" type={show ? "text" : "password"} required autoComplete="new-password" />
        <FieldError message={errors.confirmPassword} />
      </label>

      <AuthFeedback state={state} />

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
        Set password and continue
      </Button>
    </form>
  );
}
