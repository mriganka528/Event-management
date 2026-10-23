import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MailCheck, ShieldQuestion } from "lucide-react";
import { StaffStatus } from "@prisma/client";
import { requireStaffPendingPage } from "@/lib/route-guards";
import { isStaffInviteExpired } from "@/lib/mailer";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitation pending", robots: { index: false, follow: false, nocache: true } };

/**
 * Shown to a signed-in staff member whose account exists but whose invitation
 * has not been activated yet. Staff become ACTIVE when they open the activation
 * link, so this screen tells them exactly what is outstanding.
 */
export default async function StaffPendingPage() {
  const user = await requireStaffPendingPage();
  const staff = user?.staffProfile;
  if (!staff || staff.status === StaffStatus.ACTIVE) redirect("/staff");

  const typeLabel = staff.staffType.charAt(0) + staff.staffType.slice(1).toLowerCase().replaceAll("_", " ");
  const expired = isStaffInviteExpired(staff.inviteExpiresAt);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="rounded-[28px] border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-8 text-center">
        <MailCheck className="mx-auto h-11 w-11 text-[var(--warning-text)]" />
        <h1 className="mt-4 text-2xl font-semibold text-[var(--warning-text)]">
          Your invitation is {expired ? "expired" : "waiting to be activated"}
        </h1>
        <p className="mt-3 text-sm text-[var(--muted-strong)]">
          Your account was created as a <span className="font-semibold">{typeLabel}</span>. Open the activation link from your email to set your
          password and start seeing your assignments.
        </p>
      </div>

      <div className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6">
        <div className="flex items-start gap-3">
          <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted)]" />
          <div className="space-y-2 text-sm text-[var(--muted-strong)]">
            <p className="break-all font-semibold text-[var(--foreground)]">Signed in as {user?.email}</p>
            <p>
              The invitation was sent to this address. If it has expired, ask a super admin to send a new one from the Admins page. Activation links
              can only be used once.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/sign-in">
            <Button variant="outline">Sign in with another account</Button>
          </Link>
          <Link href="/">
            <Button>Back to home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
