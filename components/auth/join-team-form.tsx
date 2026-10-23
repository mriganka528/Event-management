"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Clock, Loader2, Send, ShieldCheck } from "lucide-react";
import { StaffType } from "@prisma/client";
import { submitAccessRequestAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import type { AccessRequestSummary } from "@/components/auth/action-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const staffTypeOptions = Object.values(StaffType).map((type) => ({
  label: staffTypeLabel(type),
  value: type,
}));

function staffTypeLabel(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ");
}

function formatSubmittedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(status: string | null) {
  if (status === "PENDING") return "Awaiting review";
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Declined";
  return "Sent";
}

/**
 * The request as the applicant sees it.
 *
 * Deliberately one component used for both the confirmation and the duplicate
 * refusal. The two screens used to be completely different — one listed the
 * details and the other said only "you already have a request" — so the refusal,
 * which is the screen you actually need to read, told you nothing.
 */
function RequestSummary({
  title,
  tone,
  summary,
}: {
  title: string;
  tone: "sent" | "existing";
  summary: AccessRequestSummary;
}) {
  const rows: Array<[string, string]> = [
    ["Name", summary.fullName],
    ["Email", summary.email],
  ];
  if (summary.phone) rows.push(["Phone", summary.phone]);
  rows.push(["Applying as", summary.requestedRole === "STAFF" ? "Staff member" : "Administrator"]);
  if (summary.requestedStaffType) rows.push(["Staff role", staffTypeLabel(summary.requestedStaffType)]);
  if (summary.note) rows.push(["About the role", summary.note]);
  rows.push(["Reference", summary.reference]);
  rows.push(["Status", statusLabel(summary.status)]);
  const sent = formatSubmittedAt(summary.createdAt);
  if (sent) rows.push([tone === "existing" ? "First sent" : "Sent", sent]);
  const reviewed = summary.reviewedAt ? formatSubmittedAt(summary.reviewedAt) : "";
  if (reviewed) rows.push(["Decided", reviewed]);

  return (
    <div className="mt-6 rounded-[22px] border border-[var(--line)] bg-[var(--card)] p-5 text-left">
      <p className="flex items-center gap-2 font-semibold">
        {tone === "sent" ? <CheckCircle2 className="h-4 w-4 text-[var(--success-text)]" /> : <Clock className="h-4 w-4 text-[var(--warning-text)]" />}
        {title}
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
            <dd className="mt-1 break-words text-sm font-medium text-[var(--foreground)]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        {tone === "sent"
          ? "Check the details above and quote the reference if you contact the team. An administrator may change the staff role when they review it, and you will see the outcome by email."
          : "This is what is already on file for this address, so there is nothing to send again. Quote the reference if you need to follow up."}
      </p>
    </div>
  );
}

/**
 * Public access request. Deliberately usable without an account: the whole point
 * is that a prospective team member can apply before the admin knows they exist.
 *
 * `renderedAt` is passed in from the server page rather than read from the clock
 * here. It is a client component, so `Date.now()` in this body would be evaluated
 * again during hydration, disagree with the markup the server already sent, and
 * be reported as a hydration mismatch. The server's value is stamped once and
 * serialised across, so both sides submit the same timestamp.
 */
export function JoinTeamForm({ renderedAt }: { renderedAt: number }) {
  const [state, formAction, pending] = useActionState(submitAccessRequestAction, IDLE_AUTH_STATE);
  const [role, setRole] = useState<"ADMIN" | "STAFF">("STAFF");
  // The staff role is chosen here rather than left to the `<select>` default,
  // because the default is whatever the enum happens to list first and the
  // applicant never sees it.
  const [staffType, setStaffType] = useState<StaffType>(StaffType.DECORATOR);

  useAuthToast(state);

  if (state.status === "success") {
    return (
      <div className="rounded-[28px] border border-[color:color-mix(in_srgb,var(--success-text)_28%,transparent)] bg-[var(--success-soft)] p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-[var(--success-text)]" />
          <h2 className="mt-4 text-2xl font-semibold text-[var(--success-text)]">Request sent</h2>
          <p className="mt-2 text-[var(--muted-strong)]">{state.message}</p>
        </div>

        {/*
          A confirmation that cannot be checked is not a confirmation. The
          applicant could not see what they had submitted, so they had no way to
          tell a typo in the staff role from one that was never sent.
        */}
        {state.request ? <RequestSummary title="What you sent" tone="sent" summary={state.request} /> : null}

        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          The super admin has been notified. If your request is accepted you will receive an activation link by email.
        </p>
      </div>
    );
  }

  // A refusal carries the request already on file. Showing it turns "you already
  // have a request" from a dead end into something the applicant can act on.
  if (state.status === "error" && state.previousRequest) {
    return (
      <div className="rounded-[28px] border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <Clock className="mx-auto h-10 w-10 text-[var(--warning-text)]" />
          <h2 className="mt-4 text-2xl font-semibold text-[var(--warning-text)]">Nothing was sent</h2>
          <p className="mt-2 text-[var(--muted-strong)]">{state.error}</p>
        </div>
        <RequestSummary title="The request already on file" tone="existing" summary={state.previousRequest} />
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          You can apply again once this one has been declined.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request access</CardTitle>
        <CardDescription>No account needed. A super admin reviews every request and decides who joins.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          {/*
            Two anti-bot controls. Both are invisible to a person and useless to
            a bot that cannot reason about them: a field nobody is asked to fill
            in, and a timestamp that proves the form was on screen long enough
            to type into. Neither replaces the rate limits — they just keep the
            obvious traffic off the database and off the super admins' inbox.

            `renderedAt` is uncontrolled on purpose, and its value arrives as a
            prop rather than being read from the clock here. A controlled
            timestamp is stamped again during hydration, so the server and the
            client disagree — and that disagreement is the one number the fill
            timer depends on.

            The honeypot is named and annotated to keep password managers from
            filling it. A filled honeypot used to produce a fake "request sent",
            so one autofill false positive silently lost a genuine application.
          */}
          <input type="hidden" name="renderedAt" defaultValue={renderedAt} />
          <div className="hidden" aria-hidden="true">
            <label htmlFor="join-team-website">Leave this field empty</label>
            <input
              id="join-team-website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
            />
          </div>

          <label className="grid gap-2 text-sm font-medium">
            Full name
            <Input name="fullName" required autoComplete="name" placeholder="Priya Sharma" />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Phone <span className="font-normal text-[var(--muted)]">(optional)</span>
            <Input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" />
          </label>
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">
            Email address
            <Input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            I would like to join as
            <Select
              name="requestedRole"
              value={role}
              onChange={(event) => setRole(event.target.value as "ADMIN" | "STAFF")}
              options={[
                { label: "Staff member", value: "STAFF" },
                { label: "Administrator", value: "ADMIN" },
              ]}
            />
          </label>
          {role === "STAFF" ? (
            <label className="grid gap-2 text-sm font-medium">
              Staff role <span className="text-red-600">*</span>
              <Select
                name="staffType"
                value={staffType}
                onChange={(event) => setStaffType(event.target.value as StaffType)}
                options={staffTypeOptions}
              />
              <span className="text-xs font-normal text-[var(--muted)]">
                An administrator can change this when they review your request.
              </span>
            </label>
          ) : (
            <p className="self-end rounded-2xl bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning-text)]">
              Administrator access can only be granted by a super admin.
            </p>
          )}
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">
            What will you be working on? <span className="font-normal text-[var(--muted)]">(optional)</span>
            <Textarea name="note" rows={4} maxLength={1000} placeholder="A short line about your role or what you will handle." />
          </label>

          <div className="sm:col-span-2">
            <AuthFeedback state={state} />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
              {pending ? "Sending your request…" : "Send request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
