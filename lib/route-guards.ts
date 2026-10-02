import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { RoleKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, isAdminRole, requireUserForAction, type AuthUser } from "@/lib/auth/server";
import { getAuthContext, requireAdmin, requireSuperAdmin, requireCustomer, requireStaff } from "@/lib/auth/server";
import { listActiveDevices, revokeSession } from "@/lib/auth/session";

/**
 * Guards for route handlers and pages.
 *
 * Two families live here:
 *  - `require*Page`  -> redirect, for server components
 *  - `requireApi*`   -> throw, for route handlers (a redirect cannot carry a
 *                       meaningful HTTP status)
 *
 * Both delegate to `@/lib/auth/server`, which owns the actual policy.
 */

export { isAdminRole, getAuthContext, listActiveDevices, revokeSession, AuthError };
export type { AuthUser };

// ---------------------------------------------------------------- page guards

export const requireAdminPage = requireAdmin;
export const requireSuperAdminPage = requireSuperAdmin;
export const requireCustomerPage = requireCustomer;
export const requireStaffPage = requireStaff;

/** `/staff/pending` also accepts an invited member who has not activated yet. */
export async function requireStaffPendingPage() {
  const context = await getAuthContext();
  const staff = context.user?.staffProfile;
  if (staff && staff.status !== "ACTIVE") return context.user;
  if (context.state === "UNAUTHENTICATED") redirect("/sign-in");
  if (context.user?.role === RoleKey.CUSTOMER) redirect("/customer/dashboard");
  redirect("/staff");
}

// -------------------------------------------------------------- action guards

export async function requireApiUser(): Promise<AuthUser> {
  return (await requireUserForAction()).user;
}

export async function requireApiAdmin(): Promise<AuthUser> {
  const { user } = await requireUserForAction();
  if (!isAdminRole(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

export async function requireApiSuperAdmin(): Promise<AuthUser> {
  const user = await requireApiAdmin();
  if (user.role !== RoleKey.SUPER_ADMIN) throw new AuthError("FORBIDDEN");
  return user;
}

export async function requireApiCustomer(): Promise<AuthUser> {
  const { user } = await requireUserForAction();
  if (user.role !== RoleKey.CUSTOMER) throw new AuthError("FORBIDDEN");
  return user;
}

export async function requireApiStaff(): Promise<AuthUser> {
  const { user } = await requireUserForAction();
  if (user.role !== RoleKey.STAFF && !isAdminRole(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

// ------------------------------------------------------------ error mapping

const STATUS: Record<AuthError["code"], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PENDING_APPROVAL: 403,
  MFA_REQUIRED: 403,
  SUSPENDED: 403,
  MUST_SET_PASSWORD: 403,
};

const MESSAGE: Record<AuthError["code"], string> = {
  UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "You are not authorized to perform this action.",
  PENDING_APPROVAL: "Your account is waiting for administrator approval.",
  MFA_REQUIRED: "Set up two-factor authentication before continuing.",
  SUSPENDED: "Your account is not authorized to continue.",
  MUST_SET_PASSWORD: "Finish activating your account before continuing.",
};

/**
 * Maps any thrown authorization failure to a safe `NextResponse`. The caller
 * learns only whether it is allowed, never why an account is blocked.
 */
export function accessDenied(error: unknown, fallbackMessage = "Unable to complete the request."): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: MESSAGE[error.code] }, { status: STATUS[error.code], headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: fallbackMessage }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

/** True only for a live, approved administrator. */
export async function isApprovedAdmin(userId: string): Promise<boolean> {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, accountStatus: true, role: { select: { key: true } } },
  });
  return Boolean(record?.isActive && record.accountStatus === "ACTIVE" && isAdminRole(record.role.key));
}
