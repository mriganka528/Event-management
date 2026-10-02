import { StaffStatus, StaffType } from "@prisma/client";
import { BriefcaseBusiness, MailCheck, Plus, UserCheck, UserRoundX } from "lucide-react";
import { getAdminStaff } from "@/lib/admin-data";
import { createStaffFormAction, removeStaffFormAction, resendStaffInviteFormAction, updateStaffFormAction } from "@/lib/form-actions";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

const staffTypes = Object.values(StaffType).map((type) => ({ label: type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " "), value: type }));

export default async function StaffPage() {
  const staff = await getAdminStaff();
  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">People & operations</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">The team behind the setup.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Keep availability accurate and assign the right installer, decorator, driver, or electrician to every event.</p></div><a href="#add-staff"><Button><Plus className="mr-2 h-4 w-4" />Add staff member</Button></a></section>
      <div className="grid gap-4 md:grid-cols-4">{[
        { label: "Team members", value: staff.length, icon: BriefcaseBusiness },
        { label: "Active", value: staff.filter((member) => member.status === StaffStatus.ACTIVE).length, icon: UserCheck },
        { label: "Awaiting activation", value: staff.filter((member) => member.status === StaffStatus.PENDING).length, icon: MailCheck },
        { label: "Currently assigned", value: staff.reduce((sum, member) => sum + member.assignments.length, 0), icon: UserRoundX },
      ].map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><Icon className="h-5 w-5" /></span></div></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle className="text-2xl">Staff directory</CardTitle><CardDescription>Invited staff activate from the emailed link. Availability changes take effect immediately for new assignments.</CardDescription></CardHeader><CardContent>{staff.length === 0 ? <EmptyState title="No staff members yet" description="Add your operations team below." /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{staff.map((member) => <div key={member.id} className="rounded-2xl border border-stone-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 font-semibold text-amber-800">{member.user.firstName.charAt(0)}{member.user.lastName?.charAt(0) ?? ""}</span><div><p className="font-semibold">{member.user.firstName} {member.user.lastName ?? ""}</p><p className="text-sm text-[var(--muted)]">{member.user.email}</p></div></div>{member.status === StaffStatus.ACTIVE ? <Badge className={member.isAvailable ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}>{member.isAvailable ? "Available" : "Unavailable"}</Badge> : <Badge className="bg-amber-100 text-amber-900">{member.status === StaffStatus.PENDING ? "Pending activation" : "Suspended"}</Badge>}</div><div className="mt-5 flex items-center justify-between gap-3 text-sm"><span className="capitalize text-[var(--muted)]">{member.staffType.toLowerCase().replaceAll("_", " ")}</span><span className="text-[var(--muted)]">{member.assignments.length} assignment(s)</span></div>{member.status === StaffStatus.PENDING ? <p className="mt-3 text-xs text-[var(--muted)]">Invited {member.invitedAt ? formatDate(member.invitedAt) : "recently"}. They activate from the link in their email.</p> : null}<div className="mt-4 flex items-center gap-2">{member.status === StaffStatus.ACTIVE ? <ActionForm action={updateStaffFormAction} className="flex-1"><input type="hidden" name="id" value={member.id} /><input type="hidden" name="isAvailable" value={member.isAvailable ? "false" : "true"} /><Button type="submit" size="sm" variant="outline" className="w-full">{member.isAvailable ? "Mark unavailable" : "Mark available"}</Button></ActionForm> : member.status === StaffStatus.PENDING ? <ActionForm action={resendStaffInviteFormAction} className="flex-1"><input type="hidden" name="id" value={member.id} /><Button type="submit" size="sm" variant="outline" className="w-full">Resend invite</Button></ActionForm> : null}<ActionForm action={removeStaffFormAction}><input type="hidden" name="id" value={member.id} /><Button type="submit" size="sm" variant="destructive">Remove</Button></ActionForm></div></div>)}</div>}</CardContent></Card>
      <Card id="add-staff"><CardHeader><CardTitle>Add a staff member</CardTitle><CardDescription>We will email them an invitation to activate their account. They appear as pending until they do.</CardDescription></CardHeader><CardContent><ActionForm action={createStaffFormAction} className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr_1fr_auto] lg:items-end"><label className="grid gap-2 text-sm font-medium">First name<Input name="firstName" placeholder="First name" required /></label><label className="grid gap-2 text-sm font-medium">Last name<Input name="lastName" placeholder="Last name" /></label><label className="grid gap-2 text-sm font-medium">Email<Input name="email" type="email" placeholder="team.member@example.com" required /></label><label className="grid gap-2 text-sm font-medium">Role<Select name="staffType" options={staffTypes} /></label><SubmitButton><Plus className="mr-2 h-4 w-4" />Add</SubmitButton></ActionForm></CardContent></Card>
    </main>
  );
}
