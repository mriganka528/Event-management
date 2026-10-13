import "server-only";

import { AccountStatus, RoleKey, StaffStatus, StaffType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSecurityEvent } from "@/lib/security-audit";
import { revokeAllSessions } from "@/lib/auth/session";
import { canGrantRole, canModifyAccount, canRemoveAdmin, isAdminRole } from "@/lib/access-policy";
import { withSerializableRetry } from "@/lib/transactions";

/**
 * Account lifecycle operations. Team-request handling lives in
 * `@/lib/auth/team`; this module owns approving, rejecting, suspending,
 * reactivating, and changing roles for accounts that already exist.
 *
 * Every function must be called after a `requireAdmin`/`requireSuperAdmin` guard.
 */

export class AccessManagementError extends Error {}

function assertCanModify(reviewer: { id: string; role: RoleKey }, target: { id: string; role: RoleKey }) {
  const error = canModifyAccount(reviewer, target);
  if (error) throw new AccessManagementError(error);
}

function assertEscalationAllowed(reviewerRole: RoleKey, nextRole: RoleKey) {
  const error = canGrantRole(reviewerRole, nextRole);
  if (error) throw new AccessManagementError(error);
}

export type ApproveResult = { userId: string; role: RoleKey };

/** Grants a pending or blocked account workspace access as a customer. */
export async function approveAccountAccess(input: {
  reviewer: { id: string; role: RoleKey };
  userId: string;
  reason?: string | null;
  ipAddress?: string | null;
}): Promise<ApproveResult> {
  const result = await withSerializableRetry(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: { select: { key: true } }, isActive: true, accountStatus: true } });
    if (!target) throw new AccessManagementError("User not found.");
    if (target.id === input.reviewer.id) throw new AccessManagementError("You cannot approve your own account.");
    if (target.role.key === RoleKey.SUPER_ADMIN && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
      throw new AccessManagementError("Only a super admin can approve a super admin account.");
    }
    if (target.accountStatus === AccountStatus.ACTIVE && target.isActive) {
      return { userId: target.id, role: target.role.key };
    }

    await tx.user.update({
      where: { id: target.id },
      data: { isActive: true, accountStatus: AccountStatus.ACTIVE, approvedAt: new Date(), approvedById: input.reviewer.id, suspendedAt: null, suspensionReason: null },
    });

    // The customer profile is created only on approval, so a pending sign-up
    // never owns booking or invoice data.
    if (target.role.key === RoleKey.CUSTOMER) {
      await tx.customer.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } });
    }
    if (isAdminRole(target.role.key)) {
      await tx.admin.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } });
    }
    if (target.role.key === RoleKey.STAFF) {
      await tx.staff.upsert({
        where: { userId: target.id },
        update: { status: StaffStatus.ACTIVE, activatedAt: new Date() },
        create: { userId: target.id, staffType: StaffType.DECORATOR, status: StaffStatus.ACTIVE, activatedAt: new Date() },
      });
    }
    return { userId: target.id, role: target.role.key };
  });

  await recordSecurityEvent({ type: "ACCOUNT_APPROVED", userId: result.userId, ipAddress: input.ipAddress ?? null, detail: `Account approved by reviewer ${input.reviewer.id}.` });
  return result;
}

export async function rejectAccountAccess(input: { reviewer: { id: string; role: RoleKey }; userId: string; reason?: string | null; ipAddress?: string | null }) {
  const result = await withSerializableRetry(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: { select: { key: true } } } });
    if (!target) throw new AccessManagementError("User not found.");
    if (target.id === input.reviewer.id) throw new AccessManagementError("You cannot reject your own account.");
    if (target.role.key === RoleKey.SUPER_ADMIN && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
      throw new AccessManagementError("Only a super admin can reject a super admin account.");
    }
    // Rejection also deactivates the account, so the session cookie alone can
    // never restore access.
    await tx.user.update({
      where: { id: target.id },
      data: { isActive: false, accountStatus: AccountStatus.REJECTED, suspensionReason: input.reason?.slice(0, 200) ?? null },
    });
    return { userId: target.id };
  });

  // Kill live sessions so the block is immediate rather than eventual.
  await revokeAllSessions(result.userId, "Account rejected.").catch(() => undefined);
  await recordSecurityEvent({ type: "ACCOUNT_REJECTED", userId: result.userId, ipAddress: input.ipAddress ?? null, detail: `Account rejected by reviewer ${input.reviewer.id}.` });
  return result;
}

export async function suspendAccount(input: { reviewer: { id: string; role: RoleKey }; userId: string; reason?: string | null; ipAddress?: string | null }) {
  const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: { select: { key: true } } } });
  if (!target) throw new AccessManagementError("User not found.");
  assertCanModify(input.reviewer, { id: target.id, role: target.role.key });

  await prisma.user.update({
    where: { id: target.id },
    data: { isActive: false, accountStatus: AccountStatus.SUSPENDED, suspendedAt: new Date(), suspensionReason: input.reason?.slice(0, 200) ?? null },
  });
  await revokeAllSessions(target.id, "Account suspended.").catch(() => undefined);
  await recordSecurityEvent({ type: "ACCOUNT_SUSPENDED", userId: target.id, ipAddress: input.ipAddress ?? null, detail: `Account suspended by reviewer ${input.reviewer.id}.` });
  return { userId: target.id };
}

/** Reverses a suspension or rejection. */
export async function reactivateAccount(input: { reviewer: { id: string; role: RoleKey }; userId: string; ipAddress?: string | null }) {
  const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: { select: { key: true } } } });
  if (!target) throw new AccessManagementError("User not found.");
  if (target.id === input.reviewer.id) throw new AccessManagementError("You cannot change your own access.");
  if (target.role.key === RoleKey.SUPER_ADMIN && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    throw new AccessManagementError("Only a super admin can reactivate a super admin account.");
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { isActive: true, accountStatus: AccountStatus.ACTIVE, approvedAt: new Date(), approvedById: input.reviewer.id, suspendedAt: null, suspensionReason: null },
  });
  if (target.role.key === RoleKey.CUSTOMER) {
    await prisma.customer.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } }).catch(() => undefined);
  }
  await recordSecurityEvent({ type: "ACCOUNT_REACTIVATED", userId: target.id, ipAddress: input.ipAddress ?? null, detail: `Account reactivated by reviewer ${input.reviewer.id}.` });
  return { userId: target.id };
}

/**
 * Changes a role. Separated from approval on purpose: approving grants workspace
 * access, while a role change grants privilege and is a distinct audited action.
 */
export async function changeUserRole(input: { reviewer: { id: string; role: RoleKey }; userId: string; nextRole: RoleKey; staffType?: StaffType | null; ipAddress?: string | null }) {
  const result = await withSerializableRetry(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true, role: { select: { key: true } } } });
    if (!target) throw new AccessManagementError("User not found.");
    assertCanModify(input.reviewer, { id: target.id, role: target.role.key });
    assertEscalationAllowed(input.reviewer.role, input.nextRole);

    const next = await tx.role.findUniqueOrThrow({ where: { key: input.nextRole } });
    await tx.user.update({ where: { id: target.id }, data: { roleId: next.id } });

    // Demoting away from an administrator role must delete the `Admin` row.
    // Leaving it behind produced an account that was a staff member in
    // `User.role` while still owning an `Admin` profile, which then blocked
    // `removeStaffAction` with "this person is also an administrator" for
    // somebody who no longer was one. `Admin` holds no data of its own beyond
    // `managedStaff`, and that relation is `onDelete: SetNull`, so deleting the
    // row only unlinks staff this person was supervising — it destroys nothing.
    if (!isAdminRole(input.nextRole)) {
      await tx.admin.deleteMany({ where: { userId: target.id } });
    }

    if (input.nextRole === RoleKey.STAFF) {
      const staffType = input.staffType ?? StaffType.DECORATOR;
      await tx.staff.upsert({
        where: { userId: target.id },
        update: { staffType, status: target.isActive ? StaffStatus.ACTIVE : StaffStatus.PENDING, activatedAt: target.isActive ? new Date() : null },
        create: { userId: target.id, staffType, status: target.isActive ? StaffStatus.ACTIVE : StaffStatus.PENDING, activatedAt: target.isActive ? new Date() : null },
      });
    }
    // A `Staff` row is deliberately *not* deleted when promoting to admin: it
    // owns `BookingStaff` assignments, and dropping it would cascade away real
    // event history. Someone may legitimately be both.
    if (isAdminRole(input.nextRole)) {
      await tx.admin.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } });
    }
    if (input.nextRole === RoleKey.CUSTOMER && target.isActive) {
      await tx.customer.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } });
    }
    return { userId: target.id, previousRole: target.role.key, role: input.nextRole };
  });

  // A demotion must take effect on the user's existing devices right away.
  if (result.previousRole !== result.role) {
    await revokeAllSessions(result.userId, "Role changed.").catch(() => undefined);
  }
  await recordSecurityEvent({ type: "ROLE_CHANGED", userId: result.userId, ipAddress: input.ipAddress ?? null, detail: `Role changed ${result.previousRole} -> ${result.role} by reviewer ${input.reviewer.id}.` });
  return result;
}

/** Maps the legacy activate/deactivate toggle onto suspend/reactivate. */
export async function setAccountActive(input: { reviewer: { id: string; role: RoleKey }; userId: string; isActive: boolean; ipAddress?: string | null }) {
  if (input.userId === input.reviewer.id) throw new AccessManagementError("You cannot change your own access.");
  return input.isActive ? reactivateAccount(input) : suspendAccount(input);
}

/**
 * Revokes administrator access without destroying the person.
 *
 * Suspending an admin only blocks sign-in, and the privilege itself stays on the
 * record, so it can be reinstated later. "Remove" is the stronger action a super
 * admin needs: the `Admin` row goes away, any staff this person was managing is
 * unassigned, and the account is demoted to a customer so they keep their
 * bookings and history but hold no operator access.
 *
 * The user row is deliberately kept. Deleting it would cascade to bookings,
 * invoices, and the audit trail.
 */
export async function removeAdminAccess(input: {
  reviewer: { id: string; role: RoleKey };
  userId: string;
  reason?: string | null;
  ipAddress?: string | null;
}) {
  if (input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    throw new AccessManagementError("Only a super admin can remove another administrator.");
  }

  const result = await withSerializableRetry(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, isActive: true, firstName: true, role: { select: { key: true } } },
    });
    if (!target) throw new AccessManagementError("User not found.");

    // Read inside the transaction so two concurrent removals cannot both see
    // two active super admins and remove one each.
    const activeSuperAdmins = await tx.user.count({
      where: { role: { key: RoleKey.SUPER_ADMIN }, accountStatus: AccountStatus.ACTIVE, isActive: true },
    });
    const refusal = canRemoveAdmin({
      reviewer: { id: input.reviewer.id, role: input.reviewer.role },
      target: { id: target.id, role: target.role.key },
      activeSuperAdmins,
    });
    if (refusal) throw new AccessManagementError(refusal);

    const customerRole = await tx.role.findUniqueOrThrow({ where: { key: RoleKey.CUSTOMER } });
    const adminProfile = await tx.admin.findUnique({ where: { userId: target.id }, select: { id: true } });

    // Staff this admin managed would otherwise be left pointing at a deleted
    // `Admin` row; `onDelete: SetNull` clears the link, but doing it explicitly
    // keeps the intent obvious.
    if (adminProfile) {
      await tx.staff.updateMany({ where: { adminId: adminProfile.id }, data: { adminId: null } });
    }
    await tx.admin.deleteMany({ where: { userId: target.id } });
    await tx.user.update({ where: { id: target.id }, data: { roleId: customerRole.id } });
    if (target.isActive) {
      await tx.customer.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } });
    }
    return { userId: target.id, firstName: target.firstName, previousRole: target.role.key };
  });

  await revokeAllSessions(result.userId, "Administrator access removed.").catch(() => undefined);
  await recordSecurityEvent({
    type: "ROLE_CHANGED",
    userId: result.userId,
    ipAddress: input.ipAddress ?? null,
    detail: `Administrator access removed (${result.previousRole} -> CUSTOMER) by reviewer ${input.reviewer.id}.${input.reason ? ` Reason: ${input.reason}` : ""}`,
  });
  return result;
}
