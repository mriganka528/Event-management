import { AccountStatus, RoleKey, StaffType } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { Check, Shield, ShieldAlert, ShieldCheck, UserCog, UserPlus, X } from "lucide-react";
import { getAdminUsers } from "@/lib/admin-data";
import { AdminSearch } from "@/components/admin/admin-search";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";
import { requireAdminPage } from "@/lib/route-guards";
import {
  approveUserAccessFormAction,
  changeUserRoleFormAction,
  grantAdminAccessFormAction,
  rejectUserAccessFormAction,
  reviewAdminRequestFormAction,
  updateUserActiveFormAction,
} from "@/lib/form-actions";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";
import { ActionSubmitButton } from "@/components/forms/action-submit-button";
import { RemoveAdminButton } from "./remove-admin-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admins",
  description: "Approve access requests and manage which accounts hold an administrator role.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * All colours come from the design-system tokens in `app/globals.css` so the
 * access-control screen follows the active light/dark theme.
 */
const roleClass: Record<string, string> = {
  SUPER_ADMIN: "bg-[var(--brand-soft)] text-[var(--brand-dark)]",
  ADMIN: "bg-[var(--info-soft)] text-[var(--info-text)]",
  STAFF: "bg-[var(--success-soft)] text-[var(--success-text)]",
  CUSTOMER: "bg-[var(--surface-strong)] text-[var(--muted-strong)]",
};

const statusClass: Record<AccountStatus, string> = {
  [AccountStatus.ACTIVE]: "bg-[var(--success-soft)] text-[var(--success-text)]",
  [AccountStatus.PENDING_APPROVAL]: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  [AccountStatus.REJECTED]: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  [AccountStatus.SUSPENDED]: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
};

const statusLabel: Record<AccountStatus, string> = {
  [AccountStatus.ACTIVE]: "Approved",
  [AccountStatus.PENDING_APPROVAL]: "Awaiting approval",
  [AccountStatus.REJECTED]: "Rejected",
  [AccountStatus.SUSPENDED]: "Suspended",
};

/** `DRIVER` -> `Driver`. Shared by the options and the "Wants …" badge. */
function staffTypeLabel(type: StaffType | null | undefined) {
  if (!type) return "any role";
  return type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ");
}

const staffTypeOptions = Object.values(StaffType).map((type) => ({
  label: staffTypeLabel(type),
  value: type,
}));

const roleOptions = [RoleKey.SUPER_ADMIN, RoleKey.ADMIN, RoleKey.STAFF, RoleKey.CUSTOMER].map((role) => ({
  label: role.charAt(0) + role.slice(1).toLowerCase().replaceAll("_", " "),
  value: role,
}));

/**
 * Every option a super admin may assign, but with the ones they cannot grant
 * removed. `canGrantRole` already refuses a non-super-admin from minting another
 * super admin; dropping the option from the list keeps the UI from offering a
 * choice the server will only refuse.
 */
function roleOptionsFor(viewerRole: RoleKey) {
  if (viewerRole === RoleKey.SUPER_ADMIN) return roleOptions;
  return roleOptions.filter((option) => option.value !== RoleKey.SUPER_ADMIN);
}

export default async function AdminsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const viewer = await requireAdminPage();
  const isSuperAdmin = viewer.role === RoleKey.SUPER_ADMIN;
  const { users, requests } = await getAdminUsers();
  // Rows stay in the DOM and non-matching ones are hidden, so the browser can
  // reveal them again without a round trip.
  const visibility = rowFilter(query);
  // An account carries a first and last name; an access request carries a
  // single full name. Both are searchable, so each gets its own text.
  const userText = (user: (typeof users)[number]) =>
    rowText(user.firstName, user.lastName, user.email, user.role.key, user.accountStatus);
  const requestText = (request: (typeof requests)[number]) =>
    rowText(
      request.fullName,
      request.email,
      request.phone,
      request.requestedRole,
      // The requested staff role, in both forms, so searching "driver" finds the
      // driver applications rather than only ones named "Driver".
      request.staffType,
      staffTypeLabel(request.staffType),
      request.status,
      request.note,
      request.reviewNote,
    );
  const assignableRoles = roleOptionsFor(viewer.role);
  const pendingRequests = requests.filter((request) => request.status === "PENDING");
  const awaitingApproval = users.filter((user) => user.accountStatus === AccountStatus.PENDING_APPROVAL);
  const blocked = users.filter((user) => user.accountStatus === AccountStatus.REJECTED || user.accountStatus === AccountStatus.SUSPENDED);

  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search admins"
        placeholder="Search accounts by name, email, role, or status…"
      />
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Access control</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">The right people, the right access.</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Signing in proves who someone is. It never grants access on its own — every administrator account below is held in a
          decision state until you approve it, and each approval, rejection, suspension, role change, and removal is written to
          the security log. Staff and customer accounts are managed on their own pages.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge className={statusClass[AccountStatus.PENDING_APPROVAL]}>{awaitingApproval.length} awaiting approval</Badge>
          <Badge className={statusClass[AccountStatus.REJECTED]}>{blocked.length} blocked</Badge>
          <Badge className={statusClass[AccountStatus.ACTIVE]}>{users.filter((user) => user.accountStatus === AccountStatus.ACTIVE).length} approved</Badge>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl"><ShieldAlert className="h-5 w-5 text-[var(--brand-dark)]" />Sign-ups awaiting your decision</CardTitle>
          <CardDescription>These people signed in with email or Google and have no workspace access until you approve them.</CardDescription>
        </CardHeader>
        <CardContent>
          {awaitingApproval.length === 0 ? (
            <EmptyState title="No accounts waiting" description="New sign-ups appear here the moment they authenticate with Clerk." />
          ) : (
            <div className="grid gap-3">
              {awaitingApproval.map((user) => (
                <div key={user.id} data-row-id={user.id} data-row-text={userText(user)} style={visibility(userText(user))} className="flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{user.firstName} {user.lastName ?? ""}</p>
                      <Badge className={roleClass[user.role.key] ?? roleClass.CUSTOMER}>{user.role.name}</Badge>
                      <Badge className={statusClass[user.accountStatus]}>{statusLabel[user.accountStatus]}</Badge>
                      {user.role.key !== RoleKey.CUSTOMER && !user.twoFactorEnabledAt ? <Badge className="bg-[var(--info-soft)] text-[var(--info-text)]">2FA not set up</Badge> : null}
                    </div>
                    <p className="mt-1 break-words text-sm text-[var(--muted)]">{user.email}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">Signed up {formatDate(user.createdAt)} · last sign-in {user.lastLoginAt ? formatDate(user.lastLoginAt) : "never"}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <ActionForm action={approveUserAccessFormAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <ActionSubmitButton size="sm"><Check className="mr-2 h-4 w-4" />Approve</ActionSubmitButton>
                    </ActionForm>
                    <ActionForm action={rejectUserAccessFormAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <ActionSubmitButton size="sm" variant="outline"><X className="mr-2 h-4 w-4" />Reject</ActionSubmitButton>
                    </ActionForm>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <UserPlus className="h-5 w-5 text-[var(--brand-dark)]" />
              Promote an existing account
            </CardTitle>
            <CardDescription>
              The table below lists only administrator accounts, so there is no row to promote a staff
              member or customer against. Enter their email address to grant administrator access directly.
              Only a super admin can do this, and the change is written to the security log.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={grantAdminAccessFormAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="grid flex-1 gap-2 text-sm font-medium">
                Email address
                <Input
                  name="email"
                  type="email"
                  placeholder="team.member@example.com"
                  autoComplete="off"
                  required
                  inputMode="email"
                />
              </label>
              <Button type="submit" className="w-full sm:w-auto">
                <UserPlus className="mr-2 h-4 w-4" />
                Grant administrator access
              </Button>
            </ActionForm>
            <p className="mt-3 text-xs text-[var(--muted)]">
              The account keeps its existing bookings and history. Administrator accounts must enrol in
              two-factor authentication before they can reach any admin page.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Pending role requests</CardTitle>
          <CardDescription>Approve or decline requests for staff or administrator privileges. Only a super admin can grant administrator access.</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRequests.length === 0 ? (
            <EmptyState title="No pending requests" description="Role requests from the public access form will appear here." />
          ) : (
            <div className="grid gap-3">
              {pendingRequests.map((request) => (
                <div key={request.id} data-row-id={request.id} data-row-text={requestText(request)} style={visibility(requestText(request))} className="flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{request.fullName}</p>
                      <Badge className={roleClass[request.requestedRole] ?? roleClass.CUSTOMER}>{request.requestedRole.toLowerCase()}</Badge>
                      {/*
                        What they actually asked for. Without this the only staff
                        detail on the row was an empty select, so an applicant
                        who asked to join as a driver looked identical to one who
                        asked as a decorator, and the admin approved whatever the
                        select happened to default to.
                      */}
                      {request.requestedRole === "STAFF" ? (
                        <Badge className="bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                          Wants {staffTypeLabel(request.staffType)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 break-words text-sm text-[var(--muted)]">{request.email}</p>
                    {request.phone ? <p className="mt-1 break-words text-sm text-[var(--muted)]">{request.phone}</p> : null}
                    {request.note ? <p className="mt-2 text-sm">{request.note}</p> : null}
                    <p className="mt-2 text-xs text-[var(--muted)]">Requested {formatDate(request.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {request.requestedRole === RoleKey.ADMIN && !isSuperAdmin ? (
                      <Badge className="bg-[var(--info-soft)] text-[var(--info-text)]">Super admin only</Badge>
                    ) : (
                      <>
                        {request.requestedRole === "STAFF" ? (
                          <ActionForm action={reviewAdminRequestFormAction} className="flex items-center gap-2">
                            <input type="hidden" name="requestId" value={request.id} />
                            <input type="hidden" name="decision" value="APPROVED" />
                            {/*
                              Pre-set to what they asked for and still editable, so
                              a reviewer can correct a mistaken application in one
                              click instead of approving the wrong role by accident.
                            */}
                            <Select
                              name="staffType"
                              options={staffTypeOptions}
                              defaultValue={request.staffType ?? StaffType.DECORATOR}
                              className="h-9 w-40 text-xs"
                              aria-label={`Staff role to grant ${request.fullName} as`}
                            />
                            <ActionSubmitButton size="sm"><Check className="mr-2 h-4 w-4" />Approve</ActionSubmitButton>
                          </ActionForm>
                        ) : (
                          <ActionForm action={reviewAdminRequestFormAction} className="flex items-center gap-2">
                            <input type="hidden" name="requestId" value={request.id} />
                            <input type="hidden" name="decision" value="APPROVED" />
                            <ActionSubmitButton size="sm"><Check className="mr-2 h-4 w-4" />Approve</ActionSubmitButton>
                          </ActionForm>
                        )}
                        <ActionForm action={reviewAdminRequestFormAction}>
                          <input type="hidden" name="requestId" value={request.id} />
                          <input type="hidden" name="decision" value="REJECTED" />
                          <ActionSubmitButton size="sm" variant="outline"><X className="mr-2 h-4 w-4" />Decline</ActionSubmitButton>
                        </ActionForm>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl"><ShieldAlert className="h-5 w-5 text-[var(--danger-text)]" />Blocked accounts</CardTitle>
          <CardDescription>Rejected and suspended users see a &ldquo;your request was not accepted by the admin&rdquo; message and cannot reach any workspace page.</CardDescription>
        </CardHeader>
        <CardContent>
          {blocked.length === 0 ? (
            <EmptyState title="No blocked accounts" description="Rejected and suspended users will be listed here." />
          ) : (
            <div className="grid gap-3">
              {blocked.map((user) => (
                <div key={user.id} data-row-id={user.id} data-row-text={userText(user)} style={visibility(userText(user))} className="flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--danger-text)_28%,transparent)] bg-[var(--danger-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{user.firstName} {user.lastName ?? ""}</p>
                      <Badge className={statusClass[user.accountStatus]}>{statusLabel[user.accountStatus]}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-[var(--muted)]">{user.email}</p>
                    {user.suspensionReason ? <p className="mt-2 text-sm text-[var(--danger-text)]">{user.suspensionReason}</p> : null}
                    <p className="mt-2 text-xs text-[var(--muted)]">{(user.suspendedAt ?? user.updatedAt) ? formatDate(user.suspendedAt ?? user.updatedAt) : ""}</p>
                  </div>
                  <ActionForm action={updateUserActiveFormAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <input type="hidden" name="isActive" value="true" />
                    <Button type="submit" size="sm" variant="outline"><ShieldCheck className="mr-2 h-4 w-4" />Reactivate</Button>
                  </ActionForm>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl"><Shield className="h-5 w-5 text-[var(--brand-dark)]" />Administrators and roles</CardTitle>
          <CardDescription>
            Only administrator and super administrator accounts are listed here. Staff live in
            <Link href="/admin/staff" className="mx-1 font-semibold text-[var(--brand-dark)] underline underline-offset-4">Staff</Link>
            and customers in
            <Link href="/admin/customers" className="mx-1 font-semibold text-[var(--brand-dark)] underline underline-offset-4">Customers</Link>.
            Every role change, suspension, and removal is recorded in the security log.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No administrators yet" description="Administrator accounts appear here as soon as a role is granted." />
            </div>
          ) : (
            <>
              {/* Phones get stacked cards. The seven-column table below cannot be
                  squeezed into a phone without either clipping the controls or
                  forcing a horizontal scroll on every row. */}
              <ul className="divide-y divide-[var(--line)] lg:hidden">
                {users.map((user) => {
                  const canEditRole = isSuperAdmin && user.id !== viewer.id;
                  const isActive = user.accountStatus === AccountStatus.ACTIVE;
                  return (
                    <li key={user.id} className="space-y-4 p-4">
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-[var(--foreground)]">{user.firstName} {user.lastName ?? ""}</p>
                        <p className="break-all text-sm text-[var(--muted)]">{user.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={statusClass[user.accountStatus]}>{statusLabel[user.accountStatus]}</Badge>
                        <Badge className={roleClass[user.role.key] ?? roleClass.CUSTOMER}>{user.role.name}</Badge>
                        {!user.twoFactorEnabledAt ? <Badge className="bg-[var(--info-soft)] text-[var(--info-text)]">2FA not set up</Badge> : null}
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div className="min-w-0">
                          <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Approved by</dt>
                          <dd className="truncate text-[var(--foreground)]">{user.approvedBy ? `${user.approvedBy.firstName} ${user.approvedBy.lastName ?? ""}`.trim() : "—"}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Joined</dt>
                          <dd className="truncate text-[var(--foreground)]">{formatDate(user.createdAt)}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-col gap-3">
                        {canEditRole ? (
                          <ActionForm action={changeUserRoleFormAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input type="hidden" name="userId" value={user.id} />
                            {/* `defaultValue` is what makes the control show the
                                role this person actually holds. Without it a
                                `<select>` always renders its first option, which
                                read as "Super admin" for everyone and made an
                                untouched Save silently promote somebody. */}
                            <Select name="role" options={assignableRoles} defaultValue={user.role.key} className="h-10 flex-1 text-sm" />
                            <Button type="submit" size="sm" variant="outline" className="w-full sm:w-auto">Save role</Button>
                          </ActionForm>
                        ) : (
                          <p className="text-sm text-[var(--muted)]">{user.id === viewer.id ? "This is you." : "Only a super admin can change this role."}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {user.id === viewer.id ? (
                            <Badge className="bg-[var(--surface-strong)] text-[var(--muted-strong)]">You</Badge>
                          ) : user.role.key === RoleKey.SUPER_ADMIN && !isSuperAdmin ? (
                            <span className="text-sm text-[var(--muted)]">Super admin</span>
                          ) : (
                            <>
                              <ActionForm action={updateUserActiveFormAction} className="flex-1">
                                <input type="hidden" name="userId" value={user.id} />
                                <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
                                <Button type="submit" size="sm" variant="outline" className="w-full">{isActive ? "Suspend" : "Reactivate"}</Button>
                              </ActionForm>
                              {isSuperAdmin ? (
                                <RemoveAdminButton userId={user.id} name={`${user.firstName} ${user.lastName ?? ""}`.trim() || user.email} />
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>2FA</TableHead>
                      <TableHead>Approved by</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => {
                      const canEditRole = isSuperAdmin && user.id !== viewer.id;
                      const isActive = user.accountStatus === AccountStatus.ACTIVE;
                      return (
                        <TableRow key={user.id} data-row-id={user.id} data-row-text={userText(user)} style={visibility(userText(user))}>
                          <TableCell className="min-w-[14rem]">
                            <p className="font-semibold">{user.firstName} {user.lastName ?? ""}</p>
                            <p className="break-all text-sm text-[var(--muted)]">{user.email}</p>
                          </TableCell>
                          <TableCell><Badge className={statusClass[user.accountStatus]}>{statusLabel[user.accountStatus]}</Badge></TableCell>
                          <TableCell>
                            {canEditRole ? (
                              <ActionForm action={changeUserRoleFormAction} className="flex items-center gap-2">
                                <input type="hidden" name="userId" value={user.id} />
                                <Select name="role" options={assignableRoles} defaultValue={user.role.key} className="h-9 w-40 text-xs" />
                                <Button type="submit" size="sm" variant="outline">Save</Button>
                              </ActionForm>
                            ) : (
                              <Badge className={roleClass[user.role.key] ?? roleClass.CUSTOMER}>{user.role.name}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {user.twoFactorEnabledAt ? (
                              <Badge className="bg-[var(--success-soft)] text-[var(--success-text)]">On</Badge>
                            ) : (
                              <Badge className="bg-[var(--warning-soft)] text-[var(--warning-text)]">Not set up</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-[var(--muted)]">{user.approvedBy ? `${user.approvedBy.firstName} ${user.approvedBy.lastName ?? ""}`.trim() : "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(user.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {user.id === viewer.id ? (
                                <span className="text-sm text-[var(--muted)]">You</span>
                              ) : user.role.key === RoleKey.SUPER_ADMIN && !isSuperAdmin ? (
                                <span className="text-sm text-[var(--muted)]">—</span>
                              ) : (
                                <>
                                  <ActionForm action={updateUserActiveFormAction}>
                                    <input type="hidden" name="userId" value={user.id} />
                                    <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
                                    <Button type="submit" size="sm" variant="outline">{isActive ? "Suspend" : "Reactivate"}</Button>
                                  </ActionForm>
                                  {isSuperAdmin ? (
                                    <RemoveAdminButton userId={user.id} name={`${user.firstName} ${user.lastName ?? ""}`.trim() || user.email} />
                                  ) : null}
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Role guide</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {[
            { role: RoleKey.SUPER_ADMIN, detail: "Full system access, including role changes and the security log" },
            { role: RoleKey.ADMIN, detail: "Bookings, operations, and staff approvals" },
            { role: RoleKey.STAFF, detail: "Event execution and assigned jobs" },
            { role: RoleKey.CUSTOMER, detail: "Bookings and invoices" },
          ].map((item) => (
            <div key={item.role} className="rounded-2xl bg-[var(--surface-muted)] p-4">
              <div className="flex items-center gap-2"><UserCog className="h-4 w-4 text-[var(--brand-dark)]" /><p className="font-semibold">{item.role.replaceAll("_", " ")}</p></div>
              <p className="mt-1 text-sm text-[var(--muted)]">{item.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>How access is enforced</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid list-decimal gap-3 pl-5 text-sm text-[var(--muted)]">
            <li>A Clerk session proves identity only. Sign-in with email or Google creates a local record in <span className="font-semibold text-[var(--foreground)]">Awaiting approval</span>.</li>
            <li>Every protected page and API route checks role <em>and</em> approval status server-side, so revoking access takes effect on the next request even if the session is still valid.</li>
            <li>Administrator and super administrator accounts must enable two-factor authentication before any admin page is served.</li>
            <li>Suspension and rejection deactivate the account as well, so the identity provider alone can never restore access.</li>
            <li>Accounts are never merged across sign-in providers automatically; an administrator must link them.</li>
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
