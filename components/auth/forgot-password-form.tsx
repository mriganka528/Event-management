"use client";

import { useActionState, useState } from "react";
import { ArrowRight, KeyRound, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "react-hot-toast";
import { requestPasswordResetAction, verifyPasswordResetCodeAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, type AuthActionState } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formValues,
  normaliseCode,
  toFieldErrors,
  validateResetCodeForm,
  validateResetRequestForm,
  type CredentialFieldIssue,
} from "@/lib/credential-forms";

type ServerAction = (previous: AuthActionState, formData: FormData) => Promise<AuthActionState>;

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
 * Recovery for a team member who cannot sign in.
 *
 * Step one posts the address and gets a code; step two posts that code. The
 * answers are deliberately uninformative about whether the account exists, so
 * this screen cannot be used to discover which addresses are registered.
 *
 * A verified code *redirects* to the new-password screen from the action itself
 * rather than answering with a status for this form to follow.
 */
export function ForgotPasswordForm() {
  // Bumping the round remounts the flow, which is how "use a different address"
  // returns to the first step without the two states having to be synchronised.
  const [round, setRound] = useState(0);
  return <Flow key={round} onBack={() => setRound((value) => value + 1)} />;
}

function Flow({ onBack }: { onBack: () => void }) {
  const [requestState, requestAction, requesting] = useGuardedAction(requestPasswordResetAction, validateResetRequestForm);
  const [codeState, codeAction, verifying] = useGuardedAction(verifyPasswordResetCodeAction, validateResetCodeForm);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  useAuthToast(requestState);
  useAuthToast(codeState);

  // `maskedDestination` is only present once a code really was dispatched, so its
  // presence decides which step is showing rather than a local guess.
  if (requestState.status !== "verify") {
    const errors = requestState.fieldErrors ?? {};
    return (
      <form action={requestAction} className="grid gap-4" noValidate>
        <label className="grid gap-2 text-sm font-medium">
          Your email address
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="you@example.com"
            aria-invalid={errors.email ? true : undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError message={errors.email} />
        </label>

        <AuthFeedback state={requestState} />

        <Button type="submit" disabled={requesting} aria-busy={requesting || undefined}>
          {requesting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {requesting ? "Sending your reset code…" : "Send me a reset code"}
        </Button>
      </form>
    );
  }

  const errors = codeState.fieldErrors ?? {};
  return (
    <div className="grid gap-5">
      <p className="rounded-2xl bg-[var(--card-elevated)] px-4 py-3 text-sm text-[var(--muted-strong)]">
        If <span className="font-semibold text-[var(--foreground)]">{requestState.maskedDestination}</span> belongs to a
        team account, a 6-digit code is on its way. Enter it below.
      </p>

      <form action={codeAction} className="grid gap-4" noValidate>
        <input type="hidden" name="email" value={email} />

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
            placeholder="000000"
            aria-invalid={errors.code ? true : undefined}
            value={code}
            onChange={(event) => setCode(normaliseCode(event.target.value).slice(0, 6))}
            className="text-center text-2xl font-semibold tracking-[0.4em]"
          />
          <FieldError message={errors.code} />
        </label>

        <AuthFeedback state={codeState} />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={verifying || code.length !== 6} aria-busy={verifying || undefined}>
            {verifying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {verifying ? "Verifying your code…" : "Verify and choose a new password"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Use a different address
          </Button>
        </div>
      </form>

      <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        The code expires in 10 minutes and can only be used once. Entering it signs out every other device.
      </p>
      <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Customers sign in with Google or their email address and reset their password there instead.
      </p>
    </div>
  );
}