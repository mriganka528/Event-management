"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "react-hot-toast";
import { completePasswordResetAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, type AuthActionState } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formValues, toFieldErrors, validateNewPasswordForm } from "@/lib/credential-forms";

/**
 * The last step of a password reset.
 *
 * Reachable only by the session that the verified reset code issued, and only
 * while the account is in the must-set-password state that code put it into.
 *
 * On success the action *redirects* to the sign-in screen rather than answering
 * with a status for this form to follow: it has just dropped every session, which
 * un-renders this very component, so whatever was waiting to navigate disappears
 * with it and the user is stranded.
 */
export function ResetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(async (previous, formData) => {
    const issues = validateNewPasswordForm(formValues(formData));
    if (issues.length > 0) {
      toast.error(issues[0].message);
      return { status: "error", error: issues[0].message, fieldErrors: toFieldErrors(issues) };
    }
    return completePasswordResetAction(previous, formData);
  }, IDLE_AUTH_STATE);

  // Controlled, so a rejected password survives the round trip. React resets an
  // uncontrolled form once the action settles, and asking somebody to retype a
  // twelve-character password because the policy check said "add a symbol" is a
  // reliable way to lose them halfway through a recovery.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useAuthToast(state);

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <p className="rounded-2xl border border-[var(--line)] bg-[var(--card-elevated)] px-4 py-3 text-sm text-[var(--muted-strong)]">
        Choosing a new password for <span className="font-semibold text-[var(--foreground)]">{email}</span>
      </p>

      <label className="grid gap-2 text-sm font-medium">
        New password
        <PasswordInput
          name="newPassword"
          autoComplete="new-password"
          required
          autoFocus
          placeholder="At least 12 characters"
          aria-invalid={errors.newPassword ? true : undefined}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <span className="text-xs text-[var(--muted)]">
          At least 12 characters with an uppercase letter, a lowercase letter, a number, and a symbol.
        </span>
        <FieldError message={errors.newPassword} />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Confirm new password
        <PasswordInput
          name="confirmPassword"
          autoComplete="new-password"
          required
          placeholder="Repeat the new password"
          aria-invalid={errors.confirmPassword ? true : undefined}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <FieldError message={errors.confirmPassword} />
      </label>

      <AuthFeedback state={state} />

      <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {pending ? "Saving your password…" : "Save password and sign in"}
      </Button>

      <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Saving signs out every device, this one included, so you can sign in again with the new password.
      </p>
    </form>
  );
}