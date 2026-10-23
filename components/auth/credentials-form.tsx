"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "react-hot-toast";
import { changeEmailAction, changePasswordAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, type AuthActionState } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  formValues,
  normaliseCode,
  toFieldErrors,
  validateEmailChangeForm,
  validatePasswordChangeForm,
  type CredentialFieldIssue,
} from "@/lib/credential-forms";

type ServerAction = (previous: AuthActionState, formData: FormData) => Promise<AuthActionState>;

/**
 * Wraps a server action in a required-field check.
 *
 * The browser rules run first so an empty field produces an immediate toast that
 * names it, instead of a round trip ending in a generic banner. The action still
 * re-validates everything with Zod, so this is convenience, never the boundary.
 */
function useGuardedAction(serverAction: ServerAction, validate: (values: Record<string, string>) => CredentialFieldIssue[]) {
  return useActionState<AuthActionState, FormData>(async (previous, formData) => {
    const issues = validate(formValues(formData));
    if (issues.length > 0) {
      toast.error(issues[0].message);
      return { status: "error", error: issues[0].message, fieldErrors: toFieldErrors(issues) };
    }
    return serverAction(previous, formData);
  }, IDLE_AUTH_STATE);
}

/**
 * Whether the code screen is showing, derived entirely from the server's answer.
 *
 * `maskedDestination` is only ever present once a challenge really exists, so its
 * presence *is* the proof that a code was sent. An earlier version derived this
 * from the submit button's `onClick`, which meant typing anything at all into the
 * current-password box advanced the form and announced a code that had never been
 * dispatched. Deriving it from the response removes the whole class of bug.
 */
function codeWasSent(state: AuthActionState) {
  return state.status !== "success" && Boolean(state.maskedDestination);
}

/** The 6-digit box. Shared by both cards so the two read identically. */
function CodeField({ code, onCode, error }: { code: string; onCode: (value: string) => void; error?: string }) {
  return (
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
        onChange={(event) => onCode(normaliseCode(event.target.value).slice(0, 6))}
        placeholder="000000"
        aria-invalid={error ? true : undefined}
        className="text-center text-2xl font-semibold tracking-[0.4em]"
      />
      <FieldError message={error} />
    </label>
  );
}

function DonePanel({ message, onAgain }: { message: string; onAgain: () => void }) {
  return (
    <div className="grid gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--success-text)_28%,transparent)] bg-[var(--success-soft)] p-5">
      <p className="flex items-start gap-2 text-sm font-medium text-[var(--success-text)]">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={onAgain}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
        Start again
      </Button>
    </div>
  );
}

/**
 * Lets a signed-in team member change their own email address and password.
 *
 * Both cards have the same shape, and the shape is the point: prove you know the
 * current password, then prove you control the mailbox, then the change is
 * applied. Nothing is written on the strength of an unlocked session alone.
 *
 * One form and one server action serve both steps. A submission carrying a code is
 * step two; one without is step one. Keeping a single form is what lets the
 * password fields stay filled in, so the second step never asks for a password
 * twice and nothing has to be parked server-side in between.
 */
export function CredentialsForm({ currentEmail }: { currentEmail: string }) {
  // Bumping the round remounts the card below, which resets the action state and
  // is how "use a different address" returns to the first step.
  const [round, setRound] = useState(0);
  return (
    <div className="grid gap-6">
      <EmailCard key={`email-${round}`} currentEmail={currentEmail} onBack={() => setRound((value) => value + 1)} />
      <PasswordCard key={`password-${round}`} onBack={() => setRound((value) => value + 1)} />
    </div>
  );
}

function EmailCard({ currentEmail, onBack }: { currentEmail: string; onBack: () => void }) {
  const [state, formAction, pending] = useGuardedAction(changeEmailAction, validateEmailChangeForm);
  const [code, setCode] = useState("");
  // Controlled on purpose. React resets an uncontrolled form once an action
  // settles, exactly as a native submission would, which threw away the new
  // address and the current password every time a step was rejected — the user
  // then had to retype everything to fix a single wrong character. Step two
  // submits these same values, so they have to survive step one.
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  useAuthToast(state);

  const errors = state.fieldErrors ?? {};
  if (state.status === "success") return <DonePanel message={state.message ?? "Your email address has been changed."} onAgain={onBack} />;

  const awaitingCode = codeWasSent(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-amber-700" aria-hidden="true" />Email address
        </CardTitle>
        <CardDescription>
          Currently {currentEmail}. Your current password is confirmed first, then a 6-digit code is sent to the new
          address and the change is applied only once that code comes back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4" noValidate>
          {awaitingCode ? (
            <>
              <p className="rounded-2xl bg-[var(--card-elevated)] px-4 py-3 text-sm text-[var(--muted-strong)]">
                We sent a 6-digit code to{" "}
                <span className="font-semibold text-[var(--foreground)]">{state.maskedDestination}</span>. The address is
                not changed until you enter it.
              </p>
              <CodeField code={code} onCode={setCode} error={errors.code} />
            </>
          ) : null}

          <label className="grid gap-2 text-sm font-medium">
            New email address
            <Input
              name="newEmail"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              aria-invalid={errors.newEmail ? true : undefined}
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
            <FieldError message={errors.newEmail} />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Current password
            <PasswordInput
              name="currentPassword"
              autoComplete="current-password"
              required
              placeholder="Your current password"
              aria-invalid={errors.currentPassword ? true : undefined}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <FieldError message={errors.currentPassword} />
          </label>

          <AuthFeedback state={state} />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || (awaitingCode && code.length !== 6)} aria-busy={pending || undefined}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : awaitingCode ? (
                <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {pending
                ? awaitingCode
                  ? "Confirming…"
                  : "Sending your code…"
                : awaitingCode
                  ? "Confirm the new address"
                  : "Send a code to the new address"}
            </Button>
            {awaitingCode ? (
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                Use a different address
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard({ onBack }: { onBack: () => void }) {
  const [state, formAction, pending] = useGuardedAction(changePasswordAction, validatePasswordChangeForm);
  const [code, setCode] = useState("");
  // Controlled for the same reason as the email card, and with an extra one
  // here: step two has to carry the new password again, because the server never
  // stores it between the two steps. Uncontrolled inputs would be wiped by the
  // form reset and the flow could not be completed at all.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  useAuthToast(state);

  const errors = state.fieldErrors ?? {};
  if (state.status === "success") return <DonePanel message={state.message ?? "Your password has been changed."} onAgain={onBack} />;

  const awaitingCode = codeWasSent(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-amber-700" aria-hidden="true" />Password
        </CardTitle>
        <CardDescription>
          Your current password is confirmed, then a 6-digit code is sent to your current email address. At least 12
          characters with an uppercase letter, a lowercase letter, a number, and a symbol. Every other signed-in device is
          signed out when the password changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4" noValidate>
          {awaitingCode ? (
            <>
              <p className="rounded-2xl bg-[var(--card-elevated)] px-4 py-3 text-sm text-[var(--muted-strong)]">
                We sent a 6-digit code to{" "}
                <span className="font-semibold text-[var(--foreground)]">{state.maskedDestination}</span>. Your password
                is not changed until you enter it.
              </p>
              <CodeField code={code} onCode={setCode} error={errors.code} />
              <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Leave the three fields below filled in: the new password is sent with this final step and is never stored
                in between.
              </p>
            </>
          ) : null}

          <label className="grid gap-2 text-sm font-medium">
            Current password
            <PasswordInput
              name="currentPassword"
              autoComplete="current-password"
              required
              placeholder="Your current password"
              aria-invalid={errors.currentPassword ? true : undefined}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <FieldError message={errors.currentPassword} />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            New password
            <PasswordInput
              name="newPassword"
              autoComplete="new-password"
              required
              placeholder="At least 12 characters"
              aria-invalid={errors.newPassword ? true : undefined}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
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

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || (awaitingCode && code.length !== 6)} aria-busy={pending || undefined}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : awaitingCode ? (
                <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {pending
                ? awaitingCode
                  ? "Changing your password…"
                  : "Sending your code…"
                : awaitingCode
                  ? "Confirm and change password"
                  : "Send a code and continue"}
            </Button>
            {awaitingCode ? (
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                Cancel and start again
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}