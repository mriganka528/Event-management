import "server-only";

import { AccountStatus, Prisma, RoleKey } from "@prisma/client";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/rate-limit";
import { sha256 } from "@/lib/auth/password";
import { readSessionToken, touchSession } from "@/lib/auth/session";
import { isHttps, pendingTwoFactorCookieName as pendingCookieName } from "@/lib/auth/cookie-names";
import { recordSecurityEvent } from "@/lib/security-audit";
import { deriveAccessState, isAdminRole, isPasswordRequired, type AccessState } from "@/lib/access-policy";

/**
 * Request-scoped identity resolution, replacing the former Clerk `auth()`.
 *
 * The session cookie only ever carries an opaque token; every authorisation
 * decision is made here against the database, so revoking access or suspending
 * an account takes effect on the very next request even while the cookie and
 * its database row are otherwise untouched.
 */

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  avatarUrl: string | null;
  role: RoleKey;
  accountStatus: AccountStatus;
  isActive: boolean;
  twoFactorChannel: "EMAIL" | "PHONE" | null;
  twoFactorEnabled: boolean;
  mustSetPassword: boolean;
  lastLoginAt: Date | null;
  suspensionReason: string | null;
  customerProfile: { id: string } | null;
  adminProfile: { id: string } | null;
  staffProfile: { id: string; status: string; staffType: string; isAvailable: boolean; inviteExpiresAt: Date | null } | null;
};

export type AuthSessionContext = {
  state: AccessState;
  user: AuthUser | null;
  sessionId: string | null;
  /** Set when a password was verified but the second factor is still outstanding. */
  awaitingTwoFactor: boolean;
  twoFactorChannel: "EMAIL" | "PHONE" | null;
  /** Why the session is not usable, when `state` is not ACTIVE. */
  reason: "not-approved" | "rejected" | "suspended" | "deactivated" | "mfa-required" | "must-set-password" | null;
};

export const HOME_BY_ROLE: Record<RoleKey, string> = {
  [RoleKey.SUPER_ADMIN]: "/admin",
  [RoleKey.ADMIN]: "/admin",
  [RoleKey.STAFF]: "/staff",
  [RoleKey.CUSTOMER]: "/customer/dashboard",
};

/**
 * The pending-2FA cookie is named after the request's protocol: the `__Host-`
 * prefix requires `Secure`, which a plain-http development origin cannot carry.
 * See `lib/auth/cookie-names.ts`.
 */
async function isHttpsRequest(): Promise<boolean> {
  try {
    const store = await headers();
    return isHttps(store.get("x-forwarded-proto"), process.env.NODE_ENV === "production");
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

const USER_SELECT = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  firstName: true,
  lastName: true,
  phone: true,
  phoneVerifiedAt: true,
  avatarUrl: true,
  isActive: true,
  accountStatus: true,
  // Read by `isPasswordRequired` to tell a provider-owned identity apart from
  // a team account that still owes us a password. See that function.
  clerkId: true,
  twoFactorChannel: true,
  twoFactorEnabledAt: true,
  mustSetPassword: true,
  lastLoginAt: true,
  suspensionReason: true,
  role: { select: { key: true } },
  customerProfile: { select: { id: true } },
  adminProfile: { select: { id: true } },
  staffProfile: { select: { id: true, status: true, staffType: true, isAvailable: true, inviteExpiresAt: true } },
} as const;

/**
 * The shared select plus the password hash, which only `isPasswordRequired`
 * looks at. Kept as one value so the query and the type below cannot drift.
 */
const USER_FIELDS = { ...USER_SELECT, passwordHash: true } as const;

/**
 * The account row every guard reads. Derived from the select rather than written
 * out, so a column added to one cannot fall out of the other.
 */
type UserRecord = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;

function mapUser(record: UserRecord | null): AuthUser | null {
  if (!record) return null;
  return {
    id: record.id,
    email: record.email,
    emailVerified: Boolean(record.emailVerifiedAt),
    firstName: record.firstName,
    lastName: record.lastName,
    phone: record.phone,
    phoneVerified: Boolean(record.phoneVerifiedAt),
    avatarUrl: record.avatarUrl,
    role: record.role.key,
    accountStatus: record.accountStatus,
    isActive: record.isActive,
    twoFactorChannel: record.twoFactorChannel,
    twoFactorEnabled: Boolean(record.twoFactorEnabledAt),
    lastLoginAt: record.lastLoginAt,
    suspensionReason: record.suspensionReason,
    customerProfile: record.customerProfile,
    adminProfile: record.adminProfile,
    staffProfile: record.staffProfile,
    // Resolved by the shared policy so the rule is unit-testable. This single
    // line is the difference between a Clerk customer reaching their dashboard
    // and being bounced to an activation screen they can never satisfy.
    mustSetPassword: isPasswordRequired(record),
  };
}

/**
 * Maps a resolved account onto an access state.
 *
 * The ordering decision lives in the pure policy function, which has unit
 * tests for it. It matters: `rejectAccountAccess` and `suspendAccount` also
 * clear `isActive`, so checking that flag first would report "deactivated" to a
 * user whose real problem is that their request was not accepted.
 */
function toState(user: AuthUser): { state: AccessState; reason: AuthSessionContext["reason"] } {
  const state = deriveAccessState({
    authenticated: true,
    isActive: user.isActive,
    accountStatus: user.accountStatus,
    role: user.role,
    // A privileged account with no second factor enrolled is never fully ACTIVE.
    mfaBlocked: isAdminRole(user.role) && !user.twoFactorEnabled,
  });

  const REASON_BY_STATE: Record<AccessState, AuthSessionContext["reason"]> = {
    UNAUTHENTICATED: null,
    DEACTIVATED: "deactivated",
    REJECTED: "rejected",
    SUSPENDED: "suspended",
    PENDING_APPROVAL: "not-approved",
    MFA_REQUIRED: "mfa-required",
    // `must-set-password` is an extra redirect on top of an otherwise ACTIVE
    // account, so it is resolved after the state is known.
    ACTIVE: user.mustSetPassword ? "must-set-password" : null,
  };

  return { state, reason: REASON_BY_STATE[state] };
}

/**
 * Resolves the current request's identity. `cache()` dedupes this across the
 * layout, page, and any nested server action of a single render.
 */
export const getAuthContext = cache(async (): Promise<AuthSessionContext> => {
  const token = await readSessionToken();
  if (!token) {
    const pending = await readPendingTwoFactor();
    return { state: "UNAUTHENTICATED", user: null, sessionId: null, awaitingTwoFactor: pending !== null, twoFactorChannel: pending?.channel ?? null, reason: null };
  }

  const tokenHash = sha256(token);

  // One round trip, not two. Resolving the session and then fetching the account
  // it belongs to cost a second database query on *every* page of the
  // application, because every page, layout, and nested server action resolves
  // the caller through here. `tokenHash` is unique, so the session and its user
  // can be selected in a single statement.
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    select: { id: true, status: true, user: { select: USER_FIELDS } },
    // Prisma's default strategy issues one query per relation. The account row
    // has four (role, customer, admin, staff), so this resolve cost six Neon
    // round trips before a page could start. A join makes it one.
    relationLoadStrategy: "join",
  });

  if (!session || session.status !== "ACTIVE") {
    return { state: "UNAUTHENTICATED", user: null, sessionId: null, awaitingTwoFactor: false, twoFactorChannel: null, reason: null };
  }

  const user = mapUser(session.user);
  if (!user) {
    return { state: "UNAUTHENTICATED", user: null, sessionId: null, awaitingTwoFactor: false, twoFactorChannel: null, reason: null };
  }

  void touchSession(session.id);

  const { state, reason } = toState(user);
  return { state, user, sessionId: session.id, awaitingTwoFactor: false, twoFactorChannel: user.twoFactorChannel, reason };
});

/** Alias matching the naming used by the page guards. */
export const getAccessProfile = getAuthContext;

/** The signed-in user, or null. Does not enforce role or approval. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const context = await getAuthContext();
  if (context.state !== "ACTIVE" || !context.user) return null;
  if (context.reason === "must-set-password") return null;
  return context.user;
}

/** True when the request holds a session for a fully usable account. */
export async function isSignedIn(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

export async function setPendingTwoFactor(input: { userId: string; channel: "EMAIL" | "PHONE" }) {
  const store = await cookies();
  // Must mirror the name decision in the proxy, and `Secure` has to be set
  // exactly when the `__Host-` prefix is used.
  const https = await isHttpsRequest();
  store.set(pendingCookieName(https), Buffer.from(JSON.stringify(input)).toString("base64url"), {
    httpOnly: true,
    secure: https,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
}

export async function clearPendingTwoFactor() {
  const store = await cookies();
  const https = await isHttpsRequest();
  // Clear both names so a switch between http and https cannot strand the
  // cookie and leave a half-finished sign-in permanently unresolvable.
  store.delete(pendingCookieName(https));
  store.delete(pendingCookieName(!https));
}

export async function readPendingTwoFactor(): Promise<{ userId: string; channel: "EMAIL" | "PHONE" } | null> {
  try {
    const store = await cookies();
    const https = await isHttpsRequest();
    const raw = store.get(pendingCookieName(https))?.value ?? store.get(pendingCookieName(!https))?.value;
    if (!raw) return null;
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { userId?: string; channel?: "EMAIL" | "PHONE" };
    if (!parsed.userId || (parsed.channel !== "EMAIL" && parsed.channel !== "PHONE")) return null;
    return { userId: parsed.userId, channel: parsed.channel };
  } catch {
    return null;
  }
}

/** Best-effort client fingerprint for the audit log. */
export async function requestIp(): Promise<string | null> {
  try {
    const store = await headers();
    return getClientIp({ headers: store });
  } catch {
    return null;
  }
}

export async function recordSignInBlocked(userId: string | null, email: string | null, detail: string) {
  const ip = await requestIp();
  await recordSecurityEvent({ type: "SIGN_IN_BLOCKED", userId, email, ipAddress: ip, detail });
}

const SIGN_IN_PATH = "/sign-in";
const GATE_PENDING = "/access-pending";
const GATE_DENIED = "/access-denied";
const GATE_2FA = "/two-factor-required";
const SET_PASSWORD_PATH = "/activate";

/** Central redirect decision, shared by every guard. */
export function redirectTargetFor(context: AuthSessionContext, requestedArea?: "admin" | "customer" | "staff") {
  if (context.state === "UNAUTHENTICATED") {
    if (context.awaitingTwoFactor) return "/verify-two-factor";
    return SIGN_IN_PATH;
  }
  if (context.reason === "must-set-password") return SET_PASSWORD_PATH;
  if (context.state === "PENDING_APPROVAL") return GATE_PENDING;
  if (context.state === "MFA_REQUIRED") return GATE_2FA;
  if (context.state !== "ACTIVE") return GATE_DENIED;

  const user = context.user!;
  if (requestedArea === "admin" && !isAdminRole(user.role)) return HOME_BY_ROLE[user.role];
  if (requestedArea === "customer" && user.role !== RoleKey.CUSTOMER) return HOME_BY_ROLE[user.role];
  if (requestedArea === "staff" && !(user.role === RoleKey.STAFF || isAdminRole(user.role))) return HOME_BY_ROLE[user.role];
  return null;
}

async function guard(area: "admin" | "customer" | "staff" | "any") {
  const context = await getAuthContext();
  if (context.reason === "must-set-password" || (context.state === "ACTIVE" && context.user?.mustSetPassword)) {
    redirect(SET_PASSWORD_PATH);
  }
  if (context.awaitingTwoFactor && context.state === "UNAUTHENTICATED") redirect("/verify-two-factor");

  const target = redirectTargetFor(context, area === "any" ? undefined : area);
  if (target) {
    if (context.state !== "UNAUTHENTICATED" && context.user) {
      const ip = await requestIp();
      await recordSecurityEvent({
        type: "BLOCKED_ROUTE_ATTEMPT",
        userId: context.user.id,
        email: context.user.email,
        ipAddress: ip,
        detail: `${area} denied (${context.state})`,
      });
    }
    redirect(target);
  }
  return { user: context.user!, sessionId: context.sessionId! };
}

/** Page guards. Deny by default and always explain why. */
export async function requireUser() {
  return (await guard("any")).user;
}

export async function requireAdmin() {
  return (await guard("admin")).user;
}

export async function requireSuperAdmin() {
  const { user } = await guard("admin");
  if (user.role !== RoleKey.SUPER_ADMIN) redirect("/admin?notice=super-admin-required");
  return user;
}

export async function requireCustomer() {
  return (await guard("customer")).user;
}

export async function requireStaff() {
  const { user } = await guard("staff");
  return user;
}

/** Server-action / API guard: throws instead of redirecting. */
export class AuthError extends Error {
  constructor(readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "PENDING_APPROVAL" | "MFA_REQUIRED" | "SUSPENDED" | "MUST_SET_PASSWORD") {
    super(code);
  }
}

export async function requireUserForAction() {
  const context = await getAuthContext();
  if (context.state === "UNAUTHENTICATED") throw new AuthError("UNAUTHENTICATED");
  if (context.reason === "must-set-password") throw new AuthError("MUST_SET_PASSWORD");
  if (context.state === "PENDING_APPROVAL") throw new AuthError("PENDING_APPROVAL");
  if (context.state === "MFA_REQUIRED") throw new AuthError("MFA_REQUIRED");
  if (context.state === "SUSPENDED" || context.state === "REJECTED" || context.state === "DEACTIVATED") throw new AuthError("SUSPENDED");
  return { user: context.user!, sessionId: context.sessionId! };
}

export async function requireAdminForAction() {
  const { user } = await requireUserForAction();
  if (!isAdminRole(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

export async function requireSuperAdminForAction() {
  const user = await requireAdminForAction();
  if (user.role !== RoleKey.SUPER_ADMIN) throw new AuthError("FORBIDDEN");
  return user;
}

export async function requireCustomerForAction() {
  const { user } = await requireUserForAction();
  if (user.role !== RoleKey.CUSTOMER) throw new AuthError("FORBIDDEN");
  return user;
}

export { isAdminRole };
