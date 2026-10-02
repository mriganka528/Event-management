import { AccountStatus, RoleKey, StaffType } from "@prisma/client";
import { Check, Shield, ShieldAlert, ShieldCheck, UserCog, X } from "lucide-react";
import { getAdminUsers } from "@/lib/admin-data";
import { requireAdminPage } from "@/lib/route-guards";
import {
  approveUserAccessFormAction,
  changeUserRoleFormAction,
  rejectUserAccessFormAction,
  reviewAdminRequestFormAction,
  updateUserActiveFormAction,
} from "@/lib/form-actions";
import { formatDate } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

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

const staffTypeOptions = Object.values(StaffType).map((type) => ({
  label: type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " "),
  value: type,
}));

const roleOptions = [RoleKey.SUPER_ADMIN, RoleKey.ADMIN, RoleKey.STAFF, RoleKey.CUSTOMER].map((role) => ({
  label: role.charAt(0) + role.slice(1).toLowerCase().replaceAll("_", " "),
  value: role,
}));

export default async function AdminsPage() {
  const viewer = await requireAdminPage();
  const isSuperAdmin = viewer.role === RoleKey.SUPER_ADMIN;
  const { users, requests } = await getAdminUsers();
  const pendingRequests = requests.filter((request) => request.status === "PENDING");
  const awaitingApproval = users.filter((user) => user.accountStatus === AccountStatus.PENDING_APPROVAL);
  const blocked = users.filter((user) => user.accountStatus === AccountStatus.REJECTED || user.accountStatus === AccountStatus.SUSPENDED);

  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Access control</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">The right people, the right access.</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Signing in with Clerk proves who someone is. It never grants access on its own — every account below is held in a decision state until you approve it, and
          each approval, rejection, suspension, and role change is written to the security log.
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
                <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
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
                      <Button type="submit" size="sm"><Check className="mr-2 h-4 w-4" />Approve</Button>
                    </ActionForm>
                    <ActionForm action={rejectUserAccessFormAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <Button type="submit" size="sm" variant="outline"><X className="mr-2 h-4 w-4" />Reject</Button>
                    </ActionForm>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                <div key={request.id} className="flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{request.fullName}</p>
                      <Badge className={roleClass[request.requestedRole] ?? roleClass.CUSTOMER}>{request.requestedRole.toLowerCase()}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-[var(--muted)]">{request.email}</p>
                    {request.note ? <p className="mt-2 text-sm">{request.note}</p> : null}
                    <p className="mt-2 text-xs text-[var(--muted)]">Requested {formatDate(request.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {request.requestedRole === RoleKey.ADMIN && !isSuperAdmin ? (
                      <Badge className="bg-[var(--info-soft)] text-[var(--info-text)]">Super admin only</Badge>
                    ) : (
                      <>
                        <ActionForm action={reviewAdminRequestFormAction} className="flex items-center gap-2">
                          <input type="hidden" name="requestId" value={request.id} />
                          <input type="hidden" name="decision" value="APPROVED" />
                          {request.requestedRole === "STAFF" ? <Select name="staffType" options={staffTypeOptions} className="h-9 w-40 text-xs" /> : null}
                          <Button type="submit" size="sm"><Check className="mr-2 h-4 w-4" />Approve</Button>
                        </ActionForm>
                        <ActionForm action={reviewAdminRequestFormAction}>
                          <input type="hidden" name="requestId" value={request.id} />
                          <input type="hidden" name="decision" value="REJECTED" />
                          <Button type="submit" size="sm" variant="outline"><X className="mr-2 h-4 w-4" />Decline</Button>
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
                <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--danger-text)_28%,transparent)] bg-[var(--danger-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
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
          <CardTitle className="flex items-center gap-2 text-2xl"><Shield className="h-5 w-5 text-[var(--brand-dark)]" />Users and roles</CardTitle>
          <CardDescription>All local accounts synchronized with the application. Role changes are recorded in the security log.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Approved by</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <p className="font-semibold">{user.firstName} {user.lastName ?? ""}</p>
                      <p className="break-all text-sm text-[var(--muted)]">{user.email}</p>
                    </TableCell>
                    <TableCell><Badge className={statusClass[user.accountStatus]}>{statusLabel[user.accountStatus]}</Badge></TableCell>
                    <TableCell>
                      {isSuperAdmin && user.id !== viewer.id ? (
                        <ActionForm action={changeUserRoleFormAction} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={user.id} />
                          <Select name="role" options={roleOptions} className="h-9 w-40 text-xs" />
                          <Button type="submit" size="sm" variant="outline">Save</Button>
                        </ActionForm>
                      ) : (
                        <Badge className={roleClass[user.role.key] ?? roleClass.CUSTOMER}>{user.role.name}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{user.adminProfile ? "Administrator" : user.staffProfile ? "Staff" : user.customerProfile ? "Customer" : "—"}</TableCell>
                    <TableCell className="text-sm text-[var(--muted)]">{user.approvedBy ? `${user.approvedBy.firstName} ${user.approvedBy.lastName ?? ""}`.trim() : "—"}</TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                    <TableCell>
                      {user.id === viewer.id ? (
                        <span className="text-sm text-[var(--muted)]">You</span>
                      ) : user.role.key === RoleKey.SUPER_ADMIN && !isSuperAdmin ? (
                        <span className="text-sm text-[var(--muted)]">—</span>
                      ) : (
                        <ActionForm action={updateUserActiveFormAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="isActive" value={user.accountStatus === AccountStatus.ACTIVE ? "false" : "true"} />
                          <Button type="submit" size="sm" variant="outline">{user.accountStatus === AccountStatus.ACTIVE ? "Suspend" : "Reactivate"}</Button>
                        </ActionForm>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
