import type { Metadata } from "next";
import Link from "next/link";
import { AccountStatus, StaffStatus } from "@prisma/client";
import { ShieldCheck } from "lucide-react";
import { getAuthContext } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { JoinTeamForm } from "@/components/auth/join-team-form";
import { requestStartedAt } from "@/lib/request-clock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join the team", robots: { index: true, follow: true } };

/**
 * A signed-in user who lands here sees their existing request state, so they do
 * not submit duplicates. An anonymous visitor is simply sent to the public form,
 * which needs no account.
 */
export default async function CustomerAccessPage() {
  const context = await getAuthContext();
  const user = context.user;
  // One timestamp for both branches. The form is a client component, so the
  // stamp has to be taken here: a clock read during hydration would be a
  // different number than the one in the markup the server just sent.
  const renderedAt = requestStartedAt();

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl space-y-7">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Join the team</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Request staff or admin access.</h1>
        <p className="mt-3 text-[var(--muted-strong)]">
          No account is needed to apply. A super admin reviews every request and decides who joins.
        </p>
        <JoinTeamForm renderedAt={renderedAt} />
      </div>
    );
  }

  const latest = await prisma.adminAccessRequest.findFirst({
    where: { OR: [{ requesterId: user.id }, { email: user.email }] },
    orderBy: { createdAt: "desc" },
  });
  // A removed staff member's account is suspended, but their Staff row is kept
  // (suspended, not deleted) so their previous assignments survive. They are
  // allowed to submit a fresh request; a currently suspended customer is not,
  // because re-applying must not be a way around that decision.
  const removedStaff = user.staffProfile?.status === StaffStatus.SUSPENDED;
  const suspended = user.accountStatus === AccountStatus.SUSPENDED && !removedStaff;
  const hasPendingRequest = latest?.status === "PENDING";

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Join the team</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Request staff or admin access.</h1>
        <p className="mt-3 text-[var(--muted-strong)]">A super admin reviews your request before any role is assigned.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">Signed in as {user.firstName} {user.lastName ?? ""}</p>
            <p className="break-all text-sm text-[var(--muted)]">{user.email}</p>
            {latest ? (
              <p className="mt-1 text-sm text-[var(--muted)]">
                Latest request: {latest.requestedRole.toLowerCase().replaceAll("_", " ")} on {formatDate(latest.createdAt)} ({latest.status.toLowerCase()})
              </p>
            ) : null}
            {removedStaff ? (
              <p className="mt-2 text-sm font-medium text-[var(--warning-text)]">
                Your previous staff access was removed. You can send a new request below; a super admin will review it.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={
                user.accountStatus === AccountStatus.ACTIVE
                  ? "bg-[var(--success-soft)] text-[var(--success-text)]"
                  : "bg-[var(--warning-soft)] text-[var(--warning-text)]"
              }
            >
              {user.accountStatus.replaceAll("_", " ").toLowerCase()}
            </Badge>
            {user.accountStatus === AccountStatus.ACTIVE ? (
              <Link href="/customer/dashboard">
                <Button size="sm">Go to dashboard</Button>
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {suspended ? (
        <div className="flex items-start gap-3 rounded-[28px] border border-[color:color-mix(in_srgb,var(--danger-text)_28%,transparent)] bg-[var(--danger-soft)] p-5 text-sm text-[var(--danger-text)]">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>This account is suspended, so no new request can be submitted. Contact a super admin to have it reactivated.</p>
        </div>
      ) : hasPendingRequest ? (
        <div className="flex items-start gap-3 rounded-[28px] border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-5 text-sm text-[var(--warning-text)]">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>Your request is already awaiting review. You will be able to continue as soon as a super admin approves it.</p>
        </div>
      ) : (
        <JoinTeamForm renderedAt={renderedAt} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/join-the-team">
          <Button variant="ghost" size="sm">Open the public request form</Button>
        </Link>
        <Link href="/sign-in">
          <Button variant="ghost" size="sm">Back to sign in</Button>
        </Link>
      </div>
    </div>
  );
}
