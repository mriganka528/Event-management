"use client";

import { useActionState, useState } from "react";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { StaffType } from "@prisma/client";
import { submitAccessRequestAction } from "@/lib/auth-actions";
import { AuthFeedback, IDLE_AUTH_STATE } from "@/components/auth/auth-feedback";
import { useAuthToast } from "@/components/auth/auth-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const staffTypeOptions = Object.values(StaffType).map((type) => ({
  label: type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " "),
  value: type,
}));

/**
 * Public access request. Deliberately usable without an account: the whole point
 * is that a prospective team member can apply before the admin knows they exist.
 */
export function JoinTeamForm() {
  const [state, formAction, pending] = useActionState(submitAccessRequestAction, IDLE_AUTH_STATE);
  const [role, setRole] = useState<"ADMIN" | "STAFF">("STAFF");

  useAuthToast(state);

  if (state.status === "success") {
    return (
      <div className="rounded-[28px] border border-[color:color-mix(in_srgb,var(--success-text)_28%,transparent)] bg-[var(--success-soft)] p-8 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-[var(--success-text)]" />
        <h2 className="mt-4 text-2xl font-semibold text-[var(--success-text)]">Request sent</h2>
        <p className="mt-2 text-[var(--muted-strong)]">{state.message}</p>
        <p className="mt-4 text-sm text-[var(--muted)]">
          The super admin has been notified. If your request is accepted you will receive an activation link by email.
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
              Staff role
              <Select name="staffType" options={staffTypeOptions} />
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
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send request
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
