import type { Metadata } from "next";
import Link from "next/link";
import { SecurityEventType } from "@prisma/client";
import { ArrowLeft, Lock, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { getSecurityEvents } from "@/lib/admin-data";
import { requireSuperAdminPage } from "@/lib/route-guards";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/forms/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security log", robots: { index: false, follow: false, nocache: true } };

/**
 * Severity tones come from the design-system tokens in `app/globals.css`, so the
 * audit log follows the active light/dark theme instead of a fixed palette.
 */
type Severity = "success" | "warning" | "danger" | "info";

const SEVERITY: Record<Severity, string> = {
  success: "bg-[var(--success-soft)] text-[var(--success-text)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  info: "bg-[var(--info-soft)] text-[var(--info-text)]",
};

const tone: Record<SecurityEventType, Severity> = {
  SIGN_IN_SUCCEEDED: "success",
  SIGN_IN_BLOCKED: "danger",
  SIGN_OUT: "info",
  BLOCKED_ROUTE_ATTEMPT: "danger",
  ACCESS_REQUEST_SUBMITTED: "warning",
  ACCESS_REQUEST_APPROVED: "success",
  ACCESS_REQUEST_REJECTED: "danger",
  ACCOUNT_APPROVED: "success",
  ACCOUNT_REJECTED: "danger",
  ACCOUNT_SUSPENDED: "danger",
  ACCOUNT_REACTIVATED: "info",
  ROLE_CHANGED: "info",
  TWO_FACTOR_VERIFIED: "success",
  TWO_FACTOR_FAILED: "danger",
  PASSWORD_CHANGED: "info",
  PASSWORD_RESET_REQUESTED: "warning",
  CREDENTIAL_CHANGE_BLOCKED: "warning",
  EMAIL_CHANGED: "info",
  STAFF_INVITED: "info",
  DEVICE_SESSION_CREATED: "info",
  DEVICE_SESSION_REVOKED: "warning",
  DEVICE_LIMIT_REACHED: "warning",
};

const label = (type: SecurityEventType) => type.toLowerCase().replaceAll("_", " ");

export default async function SecurityLogPage() {
  // Super admin only: the log shows who accessed what and from where.
  await requireSuperAdminPage();
  const { events, pendingAccounts, blockedSignIns } = await getSecurityEvents({ take: 200 });

  return (
    <main className="space-y-6">
      <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to dashboard</Link>

      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Append-only audit trail</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Security log.</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Every sign-in, blocked route attempt, approval, rejection, suspension, and role change is recorded here. Rows are never edited or deleted by the
          application.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Awaiting approval", value: pendingAccounts, icon: Users, tone: SEVERITY.warning },
          { label: "Blocked sign-ins / routes", value: blockedSignIns, icon: ShieldAlert, tone: SEVERITY.danger },
          { label: "Recorded events", value: events.length, icon: Lock, tone: SEVERITY.success },
        ].map(({ label: text, value, icon: Icon, tone: toneClass }) => (
          <Card key={text}>
            <CardContent className="flex items-start justify-between p-5">
              <div><p className="text-sm text-[var(--muted)]">{text}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>
              <span className={`rounded-2xl p-3 ${toneClass}`}><Icon className="h-5 w-5" /></span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl"><ShieldCheck className="h-5 w-5 text-[var(--brand-dark)]" />Events</CardTitle>
          <CardDescription>Newest first, capped at the 200 most recent entries.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <div className="p-6"><EmptyState title="No security events yet" description="Sign-ins and access decisions will be recorded here." /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-sm text-[var(--muted)]">{formatDate(event.createdAt)}</TableCell>
                      <TableCell><Badge className={SEVERITY[tone[event.type]]}>{label(event.type)}</Badge></TableCell>
                      <TableCell>
                        <p className="font-semibold">{event.user ? `${event.user.firstName} ${event.user.lastName ?? ""}`.trim() : "—"}</p>
                        <p className="break-all text-sm text-[var(--muted)]">{event.email ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-sm">{event.user?.role.key.toLowerCase().replaceAll("_", " ") ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-[var(--muted)]">{event.ipAddress ?? "—"}</TableCell>
                      <TableCell className="max-w-sm text-sm text-[var(--muted-strong)]">{event.detail ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
