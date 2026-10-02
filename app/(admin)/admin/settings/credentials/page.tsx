import { KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import { getAuthContext } from "@/lib/auth/server";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Self-service credential management.
 *
 * Only reachable with a live session, and the admin layout has already decided
 * the caller may be here. The form itself re-checks the current password, so
 * this screen is a convenience rather than the security boundary.
 */
export default async function AdminCredentialsPage() {
  const context = await getAuthContext();
  const user = context.user;

  if (!user) return null;

  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Account</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Your credentials.</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Change the email address you sign in with, or replace your password. Both require your current password, and
          every change is written to the security log.
        </p>
      </section>

      <CredentialsForm currentEmail={user.email} />

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm text-[var(--muted)]">
          <p className="flex items-start gap-2">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            A new email address is only applied after a 6-digit code sent to that address is entered, so a mistyped
            address cannot lock you out.
          </p>
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            Changing your password signs out every other device. This device stays signed in.
          </p>
          <p className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            Your two-factor setting is unchanged, so codes keep arriving at whichever address or phone you have
            enrolled.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
