"use client";

import { useActionState, useState } from "react";
import { ArrowRight, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { confirmEmailChangeAction, startEmailChangeAction, updatePasswordAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, isAwaitingCode } from "@/components/auth/auth-feedback";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Lets a signed-in administrator change their own email address and password.
 *
 * Both fields ask for the current password first, because an unlocked session is
 * not proof of ownership. The email change is a two-step flow: the address is
 * only applied after a 6-digit code sent to the *new* address comes back, so a
 * typo cannot lock the administrator out of their own account.
 */
export function CredentialsForm({ currentEmail }: { currentEmail: string }) {
  const [startState, startAction, starting] = useActionState(startEmailChangeAction, IDLE_AUTH_STATE);
  const [confirmState, confirmAction, confirming] = useActionState(confirmEmailChangeAction, IDLE_AUTH_STATE);
  const [passwordState, passwordAction, savingPassword] = useActionState(updatePasswordAction, IDLE_AUTH_STATE);

  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

  // The verify state arrives from the action, and the field then stays put so a
  // failed code attempt does not throw the address away and force a resend.
  const awaitingCode = codeSent || isAwaitingCode(startState) || isAwaitingCode(confirmState);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-amber-700" />Email address
          </CardTitle>
          <CardDescription>
            Currently {currentEmail}. A 6-digit code is sent to the new address and it only changes once you enter it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {awaitingCode ? (
            <div className="grid gap-4">
              <p className="text-sm text-[var(--muted-strong)]">
                {startState.maskedDestination ? (
                  <>We sent a 6-digit code to {startState.maskedDestination}.</>
                ) : (
                  <>We sent a 6-digit code to your new address.</>
                )}
              </p>

              <form action={confirmAction} className="grid gap-4">
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

                <AuthFeedback state={confirmState} />

                <Button type="submit" disabled={confirming || code.length !== 6}>
                  {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  Confirm the new address
                </Button>
              </form>

              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                }}
              >
                Use a different address
              </Button>
            </div>
          ) : (
            <form action={startAction} className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                New email address
                <Input name="newEmail" type="email" autoComplete="email" required placeholder="you@example.com" />
                <FieldError message={startState.fieldErrors?.newEmail} />
              </label>

              <label className="grid gap-2 text-sm font-medium">
                Current password
                <Input name="currentPassword" type="password" autoComplete="current-password" required />
                <FieldError message={startState.fieldErrors?.currentPassword} />
              </label>

              <AuthFeedback state={startState} />

              <Button type="submit" disabled={starting} onClick={() => setCodeSent(true)}>
                {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                Send a code to the new address
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-700" />Password
          </CardTitle>
          <CardDescription>
            At least 12 characters with an uppercase letter, a lowercase letter, a number, and a symbol. Every other
            signed-in device is signed out when the password changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={passwordAction} className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Current password
              <Input name="currentPassword" type="password" autoComplete="current-password" required />
            </label>

            <label className="grid gap-2 text-sm font-medium">
              New password
              <Input name="newPassword" type="password" autoComplete="new-password" required />
              <FieldError message={passwordState.fieldErrors?.newPassword} />
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Confirm new password
              <Input name="confirmPassword" type="password" autoComplete="new-password" required />
              <FieldError message={passwordState.fieldErrors?.confirmPassword} />
            </label>

            <AuthFeedback state={passwordState} />

            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
