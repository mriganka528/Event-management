"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, Loader2, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { confirmTwoFactorSetupAction, startTwoFactorSetupAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE, isAwaitingCode, nextRoute } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/auth/field-error";

/**
 * Mandatory second-factor enrolment for admin and super admin accounts. There is
 * no "skip" control: an admin who has not enrolled cannot reach an admin page.
 */
export function TwoFactorSetupForm({ phoneAvailable, defaultPhone }: { phoneAvailable: boolean; defaultPhone?: string | null }) {
  const [startState, startAction, starting] = useActionState(startTwoFactorSetupAction, IDLE_AUTH_STATE);
  const [confirmState, confirmAction, confirming] = useActionState(confirmTwoFactorSetupAction, IDLE_AUTH_STATE);
  const [channel, setChannel] = useState<"EMAIL" | "PHONE">(phoneAvailable && defaultPhone ? "PHONE" : "EMAIL");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [code, setCode] = useState("");

  useAuthToast(startState);
  useAuthToast(confirmState);
  useEffect(() => {
    const next = nextRoute(confirmState);
    if (next) window.location.assign(next);
  }, [confirmState]);

  // "Use a different option" hides the code field once. This is a user
  // override, not a copy of the action state, so it is held separately and the
  // visible step is derived from both.
  const [dismissed, setDismissed] = useState(false);
  const codeSent = !dismissed && (isAwaitingCode(startState) || isAwaitingCode(confirmState));

  return (
    <div className="grid gap-5">
      {!codeSent ? (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div className="grid gap-2" role="radiogroup" aria-label="Where to receive your codes">
              <ChannelOption
                selected={channel === "EMAIL"}
                onSelect={() => setChannel("EMAIL")}
                icon={<Mail className="h-4 w-4" />}
                title="Email"
                detail="Send a code to your account email address."
              />
              <ChannelOption
                selected={channel === "PHONE"}
                onSelect={() => setChannel("PHONE")}
                icon={<Smartphone className="h-4 w-4" />}
                title="Phone"
                detail={phoneAvailable ? "Send a code by SMS to your phone." : "Phone codes are not enabled on this deployment."}
                disabled={!phoneAvailable}
              />
            </div>

            {channel === "PHONE" ? (
              <label className="grid gap-2 text-sm font-medium">
                Phone number
                <Input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+91 98765 43210"
                />
                <FieldError message={startState.fieldErrors?.phone} />
              </label>
            ) : null}

            <form action={startAction} className="grid gap-4">
              <input type="hidden" name="channel" value={channel} />
              {channel === "PHONE" ? <input type="hidden" name="phone" value={phone} /> : null}

              <AuthFeedback state={startState} />

              <Button type="submit" disabled={starting} aria-busy={starting || undefined}>
                {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
                {starting ? "Sending your code…" : "Send my code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <p className="text-sm text-[var(--muted-strong)]">
              {startState.maskedDestination ? (
                <>We sent a 6-digit code to {startState.maskedDestination}.</>
              ) : (
                <>We sent a 6-digit code. Check your {channel === "PHONE" ? "phone" : "email"}.</>
              )}
            </p>

            <form action={confirmAction} className="grid gap-4">
              <input type="hidden" name="channel" value={channel} />
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
              <AuthFeedback state={startState} tone="info" />

              <Button type="submit" disabled={confirming || code.length !== 6} aria-busy={confirming || undefined}>
                {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />}
                {confirming ? "Turning on two-factor…" : "Turn on two-factor and continue"}
              </Button>
            </form>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDismissed(true);
                setCode("");
              }}
              className="justify-self-start"
            >
              Use a different option
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChannelOption({
  selected,
  onSelect,
  icon,
  title,
  detail,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
        disabled
          ? "cursor-not-allowed border-[var(--line)] opacity-50"
          : selected
            ? "border-[var(--brand)] bg-[var(--brand-soft)]"
            : "border-[var(--line)] bg-[var(--card-elevated)] hover:border-[var(--line-strong)]"
      }`}
    >
      <span className="mt-0.5 text-[var(--brand-dark)]">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-[var(--muted)]">{detail}</span>
      </span>
    </button>
  );
}
