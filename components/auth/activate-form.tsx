"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, UserCheck } from "lucide-react";
import { activateAccountAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, nextRoute } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
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
  // Both fields are controlled so a rejected password survives: React resets an
  // uncontrolled form when the action settles, and a member who mistypes one
  // character of a twelve-character password would otherwise start over.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const errors = state.fieldErrors ?? {};

  useAuthToast(state);
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
        <PasswordInput
          name="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="text-xs text-[var(--muted)]">At least 12 characters with upper case, lower case, a number, and a symbol.</span>
        <FieldError message={errors.password} />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Confirm password
        <PasswordInput
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <FieldError message={errors.confirmPassword} />
      </label>

      <AuthFeedback state={state} />

      <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
        {pending ? "Setting your password…" : "Set password and continue"}
      </Button>
    </form>
  );
}
