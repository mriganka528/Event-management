import { AccountStatus, RoleKey, StaffStatus } from "@prisma/client";

/**
 * Pure authorization policy.
 *
 * Deliberately free of `server-only`, `next/navigation`, the database client,
 * and any identity provider, so the rules that decide who may see what can be
 * unit-tested directly. All I/O lives in `lib/auth/*`, which delegates here.
 */

export type AccessState =
  | "UNAUTHENTICATED"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "REJECTED"
  | "SUSPENDED"
  | "DEACTIVATED"
  | "MFA_REQUIRED";

/**
 * Why a signed-in visitor is being held at a gate screen. Drives the wording
 * shown to the user, and is validated against a fixed list when it arrives as
 * a query parameter.
 */
export type GateReason =
  | "not-approved"
  | "rejected"
  | "suspended"
  | "deactivated"
  | "mfa-required"
  | "identity-conflict"
  | "unverified-email";

export type PolicyUser = {
  role: RoleKey;
  accountStatus: AccountStatus;
  isActive?: boolean;
  staffProfile?: { status: StaffStatus } | null;
};

export const ADMIN_ROLES: RoleKey[] = [RoleKey.SUPER_ADMIN, RoleKey.ADMIN];
export const STAFF_ROLES: RoleKey[] = [RoleKey.STAFF];

export function isAdminRole(role: RoleKey | null | undefined) {
  return role === RoleKey.SUPER_ADMIN || role === RoleKey.ADMIN;
}

export function isSuperAdminRole(role: RoleKey | null | undefined) {
  return role === RoleKey.SUPER_ADMIN;
}

/** Only live, approved accounts may hold a role that grants access. */
export function isAccountUsable(status: AccountStatus, isActive: boolean) {
  return isActive && status === AccountStatus.ACTIVE;
}

/** Admins and super admins must have two-factor authentication. */
export function requiresMfa(role: RoleKey) {
  return isAdminRole(role);
}

/**
 * Maps a raw account to an access state.
 *
 * Order matters. `accountStatus` is the authoritative record of the
 * administrator's decision, and suspension/rejection also clear the legacy
 * `isActive` flag. The explicit statuses are therefore checked *before*
 * `isActive`, otherwise a rejected user would be told their account was merely
 * "deactivated" instead of that their request was not accepted.
 */
export function deriveAccessState(input: {
  authenticated: boolean;
  isActive: boolean;
  accountStatus: AccountStatus;
  role: RoleKey;
  mfaBlocked: boolean;
}): AccessState {
  if (!input.authenticated) return "UNAUTHENTICATED";
  if (input.accountStatus === AccountStatus.REJECTED) return "REJECTED";
  if (input.accountStatus === AccountStatus.SUSPENDED) return "SUSPENDED";
  if (!input.isActive) return "DEACTIVATED";
  if (input.accountStatus === AccountStatus.PENDING_APPROVAL) return "PENDING_APPROVAL";
  if (input.mfaBlocked) return "MFA_REQUIRED";
  return "ACTIVE";
}

/** Workspace a fully approved account belongs to. */
export function workspaceForRole(role: RoleKey) {
  if (isAdminRole(role)) return "/admin";
  if (role === RoleKey.STAFF) return "/staff";
  return "/customer/dashboard";
}

export function landingPathForState(state: AccessState, user: { role: RoleKey } | null) {
  if (state === "UNAUTHENTICATED") return "/sign-in";
  if (state !== "ACTIVE" || !user) return gatePathForState(state);
  return workspaceForRole(user.role);
}

/**
 * Every non-usable state resolves to a screen that explains itself. Nothing
 * falls back to the home page, so a blocked user is never silently dropped.
 */
export function gatePathForState(state: AccessState) {
  switch (state) {
    case "PENDING_APPROVAL":
      return "/access-pending";
    case "MFA_REQUIRED":
      return "/two-factor-required";
    case "REJECTED":
    case "SUSPENDED":
    case "DEACTIVATED":
      return "/access-denied";
    default:
      return "/";
  }
}

/** Gate screen a blocked visitor is redirected to, per protected area. */
export function deniedPath(state: AccessState) {
  return gatePathForState(state);
}

/** Paths a successful sign-in may be redirected back to. */
export const ALLOWED_RETURN_PATHS = ["/admin", "/staff", "/customer/dashboard", "/customer/bookings/new"] as const;

/**
 * Privilege-escalation rules for reviewer -> target combinations. Returns an
 * error message when the change is not allowed, otherwise `null`.
 */
export function canModifyAccount(reviewer: { id: string; role: RoleKey }, target: { id: string; role: RoleKey }) {
  if (reviewer.id === target.id) return "You cannot change your own access.";
  if (target.role === RoleKey.SUPER_ADMIN && reviewer.role !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can change a super admin account.";
  }
  return null;
}

export function canGrantRole(reviewerRole: RoleKey, nextRole: RoleKey) {
  if (nextRole === RoleKey.SUPER_ADMIN && reviewerRole !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can grant super admin access.";
  }
  return null;
}

/** Only a super admin may approve administrator-level access. */
export function canReviewRoleRequest(reviewerRole: RoleKey, requestedRole: RoleKey) {
  if (requestedRole === RoleKey.ADMIN && reviewerRole !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can approve administrator access.";
  }
  return null;
}

/** Validates a caller-supplied `returnTo` against an explicit allowlist. */
export function safeReturnTo(value: string | undefined | null, allowed: readonly string[]) {
  if (typeof value !== "string") return null;
  return allowed.includes(value) ? value : null;
}

// ------------------------------------------------------------ external identity

/**
 * What happens when a third-party identity presents an email address that is
 * already in use locally.
 *
 * The threat is account takeover: anyone may create an account with any address
 * at an identity provider, so a successful sign-up with
 * `owner@thebusiness.com` must never be able to claim the super admin's account
 * or inherit its role. The rule is therefore deny-by-default for every local
 * role other than `CUSTOMER`, and a refused link must never be turned into a
 * create.
 */
export type ClaimOutcome = "LINK" | "REFUSE_TEAM_ACCOUNT" | "REFUSE_ALREADY_LINKED" | "REFUSE_INACTIVE" | "CREATE";

export function resolveExternalIdentityClaim(input: {
  /** Null when no local account holds that address. */
  local: { role: RoleKey; accountStatus: AccountStatus; isActive: boolean; clerkId: string | null } | null;
}): ClaimOutcome {
  if (!input.local) return "CREATE";

  // A staff account is reached with a password and a one-time code. Letting a
  // provider sign-up bind to that address would be a privilege escalation.
  if (isAdminRole(input.local.role) || input.local.role === RoleKey.STAFF) return "REFUSE_TEAM_ACCOUNT";

  // Two provider identities presenting the same address cannot both be right.
  if (input.local.clerkId) return "REFUSE_ALREADY_LINKED";

  // A rejected, suspended, or deactivated customer is never resurrected by a
  // sign-in, however the identity was proved.
  if (!isAccountUsable(input.local.accountStatus, input.local.isActive)) return "REFUSE_INACTIVE";

  return "LINK";
}
