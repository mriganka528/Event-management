import { StaffStatus, StaffType } from "@prisma/client";
import type { Metadata } from "next";
import { BriefcaseBusiness, MailCheck, Plus, UserCheck, UserRoundX } from "lucide-react";
import { getAdminStaff } from "@/lib/admin-data";
import { createStaffFormAction, removeStaffFormAction, resendStaffInviteFormAction, updateStaffFormAction } from "@/lib/form-actions";
import { formatDate, formatEventDate } from "@/lib/utils";
import { isAssignmentLive } from "@/lib/staff-assignment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";
import { AdminSearch } from "@/components/admin/admin-search";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff",
  description: "Invite team members, set their role, and control their availability.",
  robots: { index: false, follow: false, nocache: true },
};

const staffTypes = Object.values(StaffType).map((type) => ({ label: type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " "), value: type }));

/** Human label for a staff role, used in the card summary line. */
function staffTypeLabel(type: StaffType) {
  return type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ");
}

function StaffCard({ member, visibility }: { member: Awaited<ReturnType<typeof getAdminStaff>>[number]; visibility: (text: string) => { display: string } | undefined }) {
  const isActive = member.status === StaffStatus.ACTIVE;
  const isPending = member.status === StaffStatus.PENDING;
  const isRemoved = member.status === StaffStatus.SUSPENDED;
  const initials = `${member.user.firstName.charAt(0)}${member.user.lastName?.charAt(0) ?? ""}`.toUpperCase();
  /*
   * The live assignments and the finished ones.
   *
   * An assignment is released when its event ends, so a member who has worked
   * six events this season is holding none of them. The finished ones stay as
   * history — they are the record of the work they did.
   */
  const liveAssignments = member.assignments.filter((assignment) => isAssignmentLive(assignment.booking));
  const finishedAssignments = member.assignments.filter((assignment) => !isAssignmentLive(assignment.booking));
  const searchText = rowText(
    member.user.firstName,
    member.user.lastName,
    member.user.email,
    staffTypeLabel(member.staffType),
    isRemoved ? "removed suspended" : member.status,
  );

  return (
    <li data-row-id={member.id} data-row-text={searchText} style={visibility(searchText)} className="flex h-full flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 font-semibold text-amber-800">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--foreground)]">{member.user.firstName} {member.user.lastName ?? ""}</p>
            <p className="truncate text-sm text-[var(--muted)]">{member.user.email}</p>
          </div>
        </div>
        {isActive ? (
          <Badge className={member.isAvailable ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}>
            {member.isAvailable ? "Available" : "Unavailable"}
          </Badge>
        ) : (
          <Badge className={isPending ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}>
            {isPending ? "Pending activation" : isRemoved ? "Access removed" : "Suspended"}
          </Badge>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="capitalize text-[var(--muted)]">{staffTypeLabel(member.staffType)}</span>
        {/*
          The count is the live one — the assignments that still hold this
          person. The finished ones are history, and they are listed below.
        */}
        <span className="text-[var(--muted)]">{liveAssignments.length} current assignment{liveAssignments.length === 1 ? "" : "s"}</span>
        {member.managedBy ? <span className="text-[var(--muted)]">Reports to {member.managedBy.user.firstName}</span> : null}
      </div>

      {isPending ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Invited {member.invitedAt ? formatDate(member.invitedAt) : "recently"}. They activate from the link in their email.
        </p>
      ) : null}

      {isRemoved ? (
        <p className="mt-3 rounded-xl bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">
          Access removed. They are signed out, cannot sign in with their old password, and can submit a new access request for review.
        </p>
      ) : null}

      {/*
        The finished work.

        Shown for everybody, not only for a removed member. A member who is
        still on the team has usually worked events too, and those events are
        what is no longer holding them — so the list is how an administrator
        sees that they are free for the next booking.
      */}
      {finishedAssignments.length > 0 ? (
        <details className="mt-3 rounded-xl border border-[var(--line)] p-3 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer font-medium text-[var(--foreground)]">Previous work ({finishedAssignments.length})</summary>
          <ul className="mt-2 space-y-1">
            {finishedAssignments.map((assignment) => (
              <li key={assignment.id}>
                {formatEventDate(assignment.booking.eventDate)} · {assignment.booking.location} · {assignment.booking.status.toLowerCase()}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/*
        The role selector posts its own form. `defaultValue` is essential: a
        `<select>` with no value always paints its first option, so the control
        read "Decorator" for every member and an untouched save silently
        reassigned whoever was an electrician.
      */}
      {isActive ? (
        <ActionForm action={updateStaffFormAction} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="id" value={member.id} />
          <label className="sr-only" htmlFor={`staff-role-${member.id}`}>Role for {member.user.firstName}</label>
          <Select id={`staff-role-${member.id}`} name="staffType" options={staffTypes} defaultValue={member.staffType} className="h-10 flex-1 text-sm" />
          <Button type="submit" size="sm" variant="outline" className="w-full sm:w-auto">Save role</Button>
        </ActionForm>
      ) : null}

      {!isRemoved ? (
        <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row">
          {isActive ? (
            <ActionForm action={updateStaffFormAction} className="flex-1">
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="isAvailable" value={member.isAvailable ? "false" : "true"} />
              <Button type="submit" size="sm" variant="outline" className="w-full">
                {member.isAvailable ? "Mark unavailable" : "Mark available"}
              </Button>
            </ActionForm>
          ) : isPending ? (
            <ActionForm action={resendStaffInviteFormAction} className="flex-1">
              <input type="hidden" name="id" value={member.id} />
              <Button type="submit" size="sm" variant="outline" className="w-full">Resend invite</Button>
            </ActionForm>
          ) : null}
          <ActionForm action={removeStaffFormAction}>
            <input type="hidden" name="id" value={member.id} />
            <Button type="submit" size="sm" variant="destructive" className="w-full">Remove</Button>
          </ActionForm>
        </div>
      ) : null}
    </li>
  );
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const staff = await getAdminStaff();
  // Rows stay mounted and non-matching ones are hidden, so clearing the search
  // restores them instantly.
  const visibility = rowFilter(query);
  const activeCount = staff.filter((member) => member.status === StaffStatus.ACTIVE).length;
  const pendingCount = staff.filter((member) => member.status === StaffStatus.PENDING).length;
  /*
   * Only the assignments that still hold the person.
   *
   * The count was every assignment a member had ever had, so a decorator who
   * had worked six events this season read as holding six events. An
   * assignment is released when its event ends, and the person is free for the
   * next one.
   */
  const assignedCount = staff
    .filter((member) => member.status === StaffStatus.ACTIVE)
    .reduce((sum, member) => sum + member.assignments.filter((assignment) => isAssignmentLive(assignment.booking)).length, 0);

  const metrics = [
    { label: "Team members", value: staff.length, icon: BriefcaseBusiness },
    { label: "Active", value: activeCount, icon: UserCheck },
    { label: "Awaiting activation", value: pendingCount, icon: MailCheck },
    { label: "Currently assigned", value: assignedCount, icon: UserRoundX },
  ];

  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search staff"
        placeholder="Search by name, email, role, or status…"
      />
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">People &amp; operations</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">The team behind the setup.</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Keep availability accurate and assign the right installer, decorator, driver, or electrician to every event.
          </p>
        </div>
        <a href="#add-staff" className="w-full shrink-0 sm:w-auto">
          <Button className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" />Add staff member</Button>
        </a>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--muted)]">{label}</p>
                  <p className="mt-2 text-3xl font-semibold">{value}</p>
                </div>
                <span className="shrink-0 rounded-2xl bg-amber-100 p-3 text-amber-800"><Icon className="h-5 w-5" /></span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Staff directory</CardTitle>
          <CardDescription>
            Invited staff activate from the emailed link. Role changes apply to new assignments immediately, and
            availability updates are reflected the next time an administrator assigns an event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <EmptyState title="No staff members yet" description="Add your operations team below." />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {staff.map((member) => <StaffCard key={member.id} member={member} visibility={visibility} />)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="add-staff">
        <CardHeader>
          <CardTitle>Add a staff member</CardTitle>
          <CardDescription>We will email them an invitation to activate their account. They appear as pending until they do.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createStaffFormAction}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1fr_auto] lg:items-end"
          >
            <label className="grid gap-2 text-sm font-medium">
              First name
              <Input name="firstName" placeholder="First name" autoComplete="given-name" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Last name
              <Input name="lastName" placeholder="Last name" autoComplete="family-name" />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Email
              <Input name="email" type="email" placeholder="team.member@example.com" autoComplete="email" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Role
              <Select name="staffType" options={staffTypes} />
            </label>
            <SubmitButton className="w-full sm:w-auto lg:w-auto"><Plus className="mr-2 h-4 w-4" />Add</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </main>
  );
}