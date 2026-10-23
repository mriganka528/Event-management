import "server-only";

import { AccountStatus, OtpChannel, OtpPurpose, RoleKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { issueOtp, verifyOtp, OtpError, type IssueOtpResult } from "@/lib/auth/otp";
import { clearPendingTwoFactor, setPendingTwoFactor, type AuthUser } from "@/lib/auth/server";
import { createSession, currentRequestInfo, maxDevices, revokeSession, setSessionCookies, clearSessionCookies, DeviceLimitError } from "@/lib/auth/session";
import { isPhoneOtpEnabled, normalisePhone } from "@/lib/auth/sms";
import { recordSecurityEvent } from "@/lib/security-audit";

/**
 * Credential sign-in, second factor, and account provisioning.
 *
 * SECURITY ORDERING
 * -----------------
 * 1. Throttle by identifier and by IP, and lock the account after repeated
 *    failures, so credentials cannot be brute-forced.
 * 2. Verify the password. A wrong password for an unknown email costs the same
 *    work as a wrong password for a real one (a dummy hash is always computed),
 *    so response timing does not reveal which accounts exist.
 * 3. Refuse any admin role whose second factor is not set up. 2FA is not
 *    something an admin can skip.
 * 4. Issue the OTP, then create the session only after it is verified.
 */

const MAX_FAILURES = 8;
const LOCKOUT_MINUTES = 15;
const DUMMY_HASH = hashPassword("constant-work-for-unknown-accounts");

export type SignInResult =
  | { ok: true; stage: "two-factor"; channel: OtpChannel; destination: string; resendAvailableAt: Date }
  | { ok: true; stage: "session"; deviceLimit: { active: number; limit: number } }
  | { ok: false; code: SignInErrorCode; message: string };

export type SignInErrorCode =
  | "INVALID_CREDENTIALS"
  | "LOCKED"
  | "THROTTLED"
  | "ACCOUNT_INACTIVE"
  | "REJECTED"
  | "SUSPENDED"
  | "PENDING_APPROVAL"
  | "MFA_SETUP_REQUIRED"
  | "DEVICE_LIMIT_REACHED"
  | "EMAIL_UNVERIFIED"
  | "NO_PASSWORD"
  /// The password was accepted but the code could not be delivered, or too many
  /// codes were requested recently. Reported separately from bad credentials:
  /// telling somebody who has just typed the *correct* password that it is wrong
  /// sends them round in a circle resetting a password that was never the
  /// problem.
  | "CODE_NOT_SENT"
  | "CODE_RATE_LIMITED"
  /// Rejections from step 2. The password behind this screen was already
  /// accepted, so every one of these is about the code and nothing else: the
  /// user is sitting on the OTP screen with a working password, and telling them
  /// the email and password combination is wrong makes them re-type a password
  /// that was right, or go and reset one that was never the problem. The split
  /// also tells them what to do next — retype the code, or ask for a new one.
  | "INVALID_CODE"
  | "CODE_EXPIRED"
  | "CODE_ATTEMPTS_EXCEEDED"
  | "CODE_SUPERSEDED";

function friendlyMessage(code: SignInErrorCode): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "That email and password combination is not correct.";
    case "LOCKED":
      return "Too many failed attempts. Try again in a few minutes.";
    case "THROTTLED":
      return "Too many sign-in attempts. Wait a moment and try again.";
    case "ACCOUNT_INACTIVE":
      return "This account has been deactivated.";
    case "REJECTED":
      return "Your request was not accepted by the admin, so you are not authorized to continue.";
    case "SUSPENDED":
      return "Your account has been suspended. Contact an administrator.";
    case "PENDING_APPROVAL":
      return "Your account is waiting for administrator approval.";
    case "MFA_SETUP_REQUIRED":
      return "Two-factor authentication must be set up before you can sign in.";
    case "DEVICE_LIMIT_REACHED":
      return "You are signed in on the maximum number of devices. Sign one out before using another.";
    case "EMAIL_UNVERIFIED":
      return "Verify your email address before signing in.";
    case "NO_PASSWORD":
      return "Finish activating your account from the link in your email.";
    case "CODE_NOT_SENT":
      return "Your password was correct, but the sign-in code could not be sent. Try again in a minute.";
    case "CODE_RATE_LIMITED":
      return "Too many codes have been requested for this account. Wait an hour before asking for another.";
    case "INVALID_CODE":
      return "That code is not correct. Check it and try again.";
    case "CODE_EXPIRED":
      return "That code has expired. Request a new one.";
    case "CODE_ATTEMPTS_EXCEEDED":
      return "Too many incorrect attempts. Request a new code.";
    case "CODE_SUPERSEDED":
      return "That code is no longer valid. Request a new one.";
  }
}

/**
 * Describes a rejected sign-in code.
 *
 * The password behind the OTP screen was accepted in step 1, so this must never
 * come back as `INVALID_CREDENTIALS` — the same rule `CODE_NOT_SENT` follows on
 * the issuance side. Each outcome gets its own code and wording, because they
 * call for different things: retype the code, wait for a new one, or stop
 * guessing and request a fresh code.
 *
 * The message from the OTP layer is kept where there is one, because it carries
 * the attempts-left countdown that tells the user a further guess is still
 * allowed. Anything else falls back to the generic wording rather than being
 * passed through, so an unexpected throw cannot leak internals.
 */
function otpFailure(error: unknown): { code: SignInErrorCode; message: string } {
  const otpCode = error instanceof OtpError ? error.code : null;
  let code: SignInErrorCode = "INVALID_CODE";
  switch (otpCode) {
    case "EXPIRED":
      code = "CODE_EXPIRED";
      break;
    case "TOO_MANY_ATTEMPTS":
      code = "CODE_ATTEMPTS_EXCEEDED";
      break;
    case "NOT_FOUND":
    case "ALREADY_USED":
      code = "CODE_SUPERSEDED";
      break;
  }
  const message = error instanceof OtpError && error.message ? error.message : friendlyMessage(code);
  return { code, message };
}

async function recentFailures(identifier: string, ipAddress: string | null) {
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000);
  const [byAccount, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { identifier, successful: false, createdAt: { gte: since } } }),
    ipAddress ? prisma.loginAttempt.count({ where: { ipAddress, successful: false, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  return { byAccount, byIp };
}

async function logAttempt(identifier: string, ipAddress: string | null, successful: boolean) {
  await prisma.loginAttempt.create({ data: { identifier, ipAddress, successful } }).catch(() => undefined);
}

function fail(code: SignInErrorCode, status = 400, message?: string): SignInResult {
  return { ok: false, code, message: message ?? friendlyMessage(code), status } as SignInResult & { status?: number };
}

/** Step 1 of sign-in: password verification, then OTP issuance. */
export async function beginSignIn(input: {
  email: string;
  password: string;
  ipAddress: string | null;
  deviceId: string;
}): Promise<SignInResult> {
  const email = input.email.trim().toLowerCase();
  const identifier = `email:${email}`;

  const { byAccount, byIp } = await recentFailures(identifier, input.ipAddress);
  if (byAccount >= MAX_FAILURES) return fail("LOCKED", 429);
  if (byIp >= MAX_FAILURES * 4) return fail("THROTTLED", 429);

  const account = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, firstName: true, role: { select: { key: true } }, isActive: true,
      accountStatus: true, passwordHash: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true,
      twoFactorChannel: true, twoFactorEnabledAt: true, mustSetPassword: true, failedSignInCount: true,
    },
  });

  // Always run a hash so a missing account and a wrong password take the same
  // time; otherwise the endpoint becomes an account-enumeration oracle.
  const stored = account?.passwordHash ?? DUMMY_HASH;
  const passwordOk = verifyPassword(input.password, stored);

  if (!account || !passwordOk) {
    await logAttempt(identifier, input.ipAddress, false);
    if (account) {
      await prisma.user.update({ where: { id: account.id }, data: { failedSignInCount: { increment: 1 } } }).catch(() => undefined);
    }
    await recordSecurityEvent({ type: "SIGN_IN_BLOCKED", userId: account?.id ?? null, email, ipAddress: input.ipAddress, detail: "Invalid credentials." });
    return fail("INVALID_CREDENTIALS", 401);
  }

  if (!account.passwordHash || account.mustSetPassword) return fail("NO_PASSWORD", 409);
  if (!account.isActive) return fail("ACCOUNT_INACTIVE", 403);
  if (account.accountStatus === AccountStatus.REJECTED) return fail("REJECTED", 403);
  if (account.accountStatus === AccountStatus.SUSPENDED) return fail("SUSPENDED", 403);
  if (account.accountStatus === AccountStatus.PENDING_APPROVAL) return fail("PENDING_APPROVAL", 403);
  if (!account.emailVerifiedAt) return fail("EMAIL_UNVERIFIED", 403);

  const privileged = account.role.key === RoleKey.ADMIN || account.role.key === RoleKey.SUPER_ADMIN;

  const channel = account.twoFactorChannel ?? (isPhoneOtpEnabled() && account.phoneVerifiedAt ? OtpChannel.PHONE : OtpChannel.EMAIL);

  // The pending cookie is the only handle the *next* request has on this
  // half-finished sign-in, and both screens that can receive this user
  // (/verify-two-factor and /two-factor-setup) resolve the account from it.
  // It is written here, immediately after the password was accepted and before
  // any branch that returns early, because the privileged branch below never
  // sends a code yet still has to identify the user on the following request.
  await clearPendingTwoFactor();
  await setPendingTwoFactor({ userId: account.id, channel });

  // A privileged account must already have a working second factor. The setup
  // flow itself needs a session, so a freshly-provisioned admin is allowed in
  // only as far as /two-factor-setup.
  if (privileged && !account.twoFactorEnabledAt) {
    return { ok: true, stage: "session", deviceLimit: { active: 0, limit: maxDevices() } } satisfies SignInResult;
  }
  if (channel === OtpChannel.PHONE && !isPhoneOtpEnabled()) {
    // The provider went away; fall back to email rather than locking them out.
    await clearPendingTwoFactor();
    return fail("MFA_SETUP_REQUIRED", 403);
  }

  const destination = channel === OtpChannel.EMAIL ? email : (normalisePhone(account.phone ?? "") ?? email);
  const issued: IssueOtpResult = await issueOtp({
    userId: account.id,
    email,
    phone: account.phone,
    channel,
    purpose: OtpPurpose.TWO_FACTOR,
    ipAddress: input.ipAddress,
  });
  if (!issued.ok) {
    // No code was sent, so there is no half-finished sign-in to resume.
    await clearPendingTwoFactor();
    // Distinct from a rejected password: the credentials were accepted, so
    // saying otherwise would send the user back to check a password that was
    // never wrong.
    if (issued.code === "RATE_LIMITED") return fail("CODE_RATE_LIMITED", 429);
    return fail("CODE_NOT_SENT", 503);
  }

  await prisma.user.update({ where: { id: account.id }, data: { failedSignInCount: 0 } }).catch(() => undefined);
  await logAttempt(identifier, input.ipAddress, true);

  return { ok: true, stage: "two-factor", channel, destination, resendAvailableAt: issued.resendAvailableAt } satisfies SignInResult;
}

/** Step 2 of sign-in: verify the OTP, then issue the session. */
export async function completeSignIn(input: {
  userId: string;
  code: string;
  ipAddress: string | null;
  deviceId: string;
}): Promise<SignInResult> {
  const account = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, phone: true, role: { select: { key: true } }, isActive: true, accountStatus: true, twoFactorChannel: true, twoFactorEnabledAt: true },
  });
  if (!account || !account.isActive) return fail("ACCOUNT_INACTIVE", 403);
  if (account.accountStatus !== AccountStatus.ACTIVE) return fail("SUSPENDED", 403);

  const channel = account.twoFactorChannel ?? OtpChannel.EMAIL;
  const destination = channel === OtpChannel.EMAIL ? account.email : (normalisePhone(account.phone ?? "") ?? account.email);

  try {
    await verifyOtp({ userId: account.id, destination, purpose: OtpPurpose.TWO_FACTOR, code: input.code });
  } catch (error) {
    await recordSecurityEvent({
      type: "TWO_FACTOR_FAILED",
      userId: account.id,
      email: account.email,
      ipAddress: input.ipAddress,
      detail: error instanceof Error ? error.message : "Invalid code.",
    });
    // The password was accepted in step 1, so a failure here is about the code
    // and only the code. Reporting INVALID_CREDENTIALS told the user their
    // email and password were wrong when they were not, and pointed them at a
    // password reset that could not fix anything.
    const failure = otpFailure(error);
    return fail(failure.code, 401, failure.message);
  }

  await recordSecurityEvent({ type: "TWO_FACTOR_VERIFIED", userId: account.id, email: account.email, ipAddress: input.ipAddress, detail: `Second factor satisfied over ${channel.toLowerCase()}.` });

  return issueSession({ userId: account.id, channel, ipAddress: input.ipAddress, deviceId: input.deviceId });
}

/** Issues the session cookie for a user who has cleared every gate. */
export async function issueSession(input: {
  userId: string;
  channel?: OtpChannel | null;
  ipAddress: string | null;
  deviceId?: string | null;
}): Promise<SignInResult> {
  const info = await currentRequestInfo();
  const deviceId = input.deviceId ?? info.deviceId;
  try {
    const session = await createSession({
      userId: input.userId,
      twoFactorUsed: input.channel ?? null,
      info: { ...info, deviceId },
      existingDeviceId: deviceId,
    });
    await setSessionCookies(session.token, deviceId);
    await clearPendingTwoFactor();

    await prisma.user.update({
      where: { id: input.userId },
      data: { lastLoginAt: new Date(), lastLoginIp: input.ipAddress, signInCount: { increment: 1 } },
    });
    await recordSecurityEvent({ type: "SIGN_IN_SUCCEEDED", userId: input.userId, ipAddress: input.ipAddress, detail: `Signed in (${session.activeDevices}/${maxDevices()} devices).` });

    return { ok: true, stage: "session", deviceLimit: { active: session.activeDevices, limit: maxDevices() } } satisfies SignInResult;
  } catch (error) {
    if (error instanceof DeviceLimitError) {
      return { ok: false, code: "DEVICE_LIMIT_REACHED", message: error.message } satisfies SignInResult;
    }
    throw error;
  }
}

export async function signOut(sessionId: string | null, userId: string | null) {
  if (sessionId) await revokeSession(sessionId, "Signed out.", userId ?? undefined);
  await clearSessionCookies();
  await clearPendingTwoFactor();
  await recordSecurityEvent({ type: "SIGN_OUT", userId, detail: "User signed out." });
}

export function accountForAudit(user: AuthUser) {
  return { id: user.id, email: user.email };
}
