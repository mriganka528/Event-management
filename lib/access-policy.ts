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

/**
 * Whether this account still owes us a password.
 *
 * The `mustSetPassword` flag is only meaningful for accounts that authenticate
 * first-party. A customer created by a public booking request has no password
 * hash, and neither does a customer federated from Clerk — both sign in through
 * the provider and can never complete a first-party password flow.
 *
 * Treating any null hash as "must set a password" therefore locked those
 * customers out permanently: every guard resolved them to the `must-set-password`
 * state and redirected them to `/activate`, where no such flow existed for them.
 * In practice the customer dashboard simply never rendered, which reads as "my
 * orders are missing" rather than as an authentication bug.
 *
 * A linked `clerkId` is the authoritative signal that the provider owns this
 * identity. Everything else keeps the original behaviour, so a team account
 * created by an admin (`mustSetPassword: true`, no hash yet) is still correctly
 * sent to `/activate`.
 */
export function isPasswordRequired(account: {
  mustSetPassword: boolean;
  passwordHash: string | null;
  clerkId?: string | null;
}) {
  if (account.clerkId) return false;
  return account.mustSetPassword || !account.passwordHash;
}

/**
 * True when this account is a customer *record* rather than an identity: a
 * customer with nothing to sign in with.
 *
 * The public booking form creates exactly this. An enquiry from an address with
 * no account gets a customer record so the booking has somewhere to attach, and
 * that record is created deliberately without a login — see
 * `getOrCreatePublicCustomer` in `lib/bookings.ts`. The next enquiry from the same
 * address was then refused with "sign in with the account email", advice that
 * record can never follow: no password, no provider identity, nothing to sign in
 * *with*. A customer who asked twice could not ask a third time, and the form is
 * the only way for them to reach the business at all.
 *
 * Such a record holds no identity to take over. It has no credentials, so
 * claiming the address takes nothing from its owner, and its history is visible to
 * an administrator rather than to whoever submits the form. Reusing it is also
 * what the first enquiry already implied: one customer record per address, made on
 * demand.
 *
 * Everything with a sign-in behind it is excluded, deliberately and by the same
 * rule the rest of this file uses — a self-registered customer with a password, an
 * invited team member still on `must-set-password`, and a Clerk-federated account,
 * which signs in through the provider and has no hash to find.
 */
export function isSignInlessCustomerRecord(account: {
  role: RoleKey;
  mustSetPassword: boolean;
  passwordHash: string | null;
  clerkId?: string | null;
}) {
  return account.role === RoleKey.CUSTOMER && isPasswordRequired({ mustSetPassword: account.mustSetPassword, passwordHash: account.passwordHash, clerkId: account.clerkId });
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

/**
 * Who may hand out a role.
 *
 * Administrator access is a super-admin decision, and this is the only place
 * that rule is written down. Every path that creates or promotes an
 * administrator already requires a super admin: the access-request review
 * (`canReviewRoleRequest`), the direct invite (`inviteTeamMember`), and the
 * promotion action (`grantAdminAccessAction`).
 *
 * The role-change form was the exception. The screen hides it from anybody who
 * is not a super admin, but the action behind it was reachable by any admin,
 * so an ordinary admin could promote somebody — themselves included, once
 * `canModifyAccount` is satisfied — to administrator and hand out access that
 * the rest of the codebase reserves for a super admin.
 *
 * Granting *super admin* is likewise refused to everybody but a super admin.
 */
export function canGrantRole(reviewerRole: RoleKey, nextRole: RoleKey) {
  if (nextRole === RoleKey.SUPER_ADMIN && reviewerRole !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can grant super admin access.";
  }
  if (nextRole === RoleKey.ADMIN && reviewerRole !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can grant administrator access.";
  }
  return null;
}

/**
 * Who may revoke administrator access, as distinct from suspending an account.
 *
 * Suspension is reversible and available to any admin; removal destroys the
 * privilege and demotes the person, so it is super-admin-only. Removing a super
 * admin is refused outright rather than merely restricted, because the only way
 * to do it safely is to demote them first — which is a different, deliberate
 * action with its own audit entry.
 *
 * `activeSuperAdmins` guards the last-super-admin case: the screen that can undo
 * a bad removal is itself only reachable by a super admin, so removing the final
 * one would lock everyone out of the workspace permanently.
 */
export function canRemoveAdmin(input: {
  reviewer: { id: string; role: RoleKey };
  target: { id: string; role: RoleKey };
  activeSuperAdmins: number;
}) {
  if (input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can remove another administrator.";
  }
  if (input.target.id === input.reviewer.id) return "You cannot remove your own account.";
  if (!isAdminRole(input.target.role)) return "This person is not an administrator.";
  if (input.target.role === RoleKey.SUPER_ADMIN) {
    if (input.activeSuperAdmins <= 1) {
      return "This is the only active super admin. Promote another super admin first.";
    }
    return "A super admin cannot be removed. Change their role to admin first.";
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

/**
 * Who may erase a customer's personal details.
 *
 * This is not the same action as suspending, which is reversible and available
 * to any admin: removing scrubs the name, contact details, credentials, and
 * provider link for good. It is therefore super-admin-only.
 *
 * The target must actually be a customer. A staff or administrator account that
 * happens to carry a `Customer` profile — someone demoted from the team, for
 * instance — has to be handled through the access-control screen instead, where
 * the role change and its consequences are the thing being recorded.
 *
 * The customer's *history* is not the target and is never touched; see
 * `removeCustomerAccess` for why it cannot be.
 */
export function canRemoveCustomer(input: {
  reviewer: { id: string; role: RoleKey };
  target: { id: string; role: RoleKey };
}) {
  if (input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    return "Only a super admin can remove a customer record.";
  }
  if (input.target.id === input.reviewer.id) return "You cannot remove your own account.";
  if (input.target.role !== RoleKey.CUSTOMER) {
    return "This person is on the team. Remove their access from Access control instead.";
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
