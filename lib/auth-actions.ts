"use server";

import { OtpChannel, OtpPurpose, RoleKey } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp, allowRequest } from "@/lib/rate-limit";
import { getAuthContext, HOME_BY_ROLE, requestIp, clearPendingTwoFactor, readPendingTwoFactor } from "@/lib/auth/server";
import { beginSignIn, completeSignIn, issueSession, signOut } from "@/lib/auth/sign-in";
import { issueOtp, verifyOtp } from "@/lib/auth/otp";
import { activateWithToken, confirmTwoFactor, enableTwoFactor, resendTeamInvite, submitAccessRequest } from "@/lib/auth/team";
import { isPhoneOtpEnabled, maskEmail, maskPhone, normalisePhone } from "@/lib/auth/sms";
import { revokeAllSessions, readSessionToken } from "@/lib/auth/session";
import { sha256, assertPasswordAcceptable, hashPassword, verifyPassword } from "@/lib/auth/password";
import { recordSecurityEvent } from "@/lib/security-audit";
import { safeReturnTo } from "@/lib/access-policy";
// From the plain module, not `auth-feedback`: a type import is erased today, but
// routing it through a "use client" module invites a runtime client reference.
import type { AuthActionState } from "@/components/auth/action-state";

/**
 * Server actions for the first-party authentication flow.
 *
 * Every action re-derives its own security context from the request; nothing is
 * trusted from a hidden field, and the session cookie is never read on the
 * client.
 */

const ALLOWED_REPORT = ["/admin", "/staff", "/customer/dashboard", "/customer/bookings/new"] as const;

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const passwordSchema = z.string().min(1, "Enter your password.").max(200);
const codeSchema = z.string().trim().min(4, "Enter the code.").max(12);

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.filter((p): p is string => typeof p === "string").at(0);
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function str(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function clientIdentity() {
  const store = await headers();
  return {
    ipAddress: getClientIp({ headers: store }),
    deviceId: store.get("event_device") ?? "",
  };
}

/** Step 1: password. Returns `verify` so the client can move to the OTP screen. */
export async function beginSignInAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z.object({ email: emailSchema, password: passwordSchema, returnTo: z.string().optional() }).safeParse({
    email: str(formData, "email"),
    password: str(formData, "password"),
    returnTo: str(formData, "returnTo") || undefined,
  });
  if (!parsed.success) return { status: "error" as const, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { ipAddress, deviceId } = await clientIdentity();
  if (!allowRequest(`signin:${ipAddress}`, 20, 10 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Wait a few minutes and try again." };
  }

  const result = await beginSignIn({ email: parsed.data.email, password: parsed.data.password, ipAddress, deviceId });
  if (!result.ok) return { status: "error" as const, error: result.message };

  const returnTo = safeReturnTo(parsed.data.returnTo, ALLOWED_REPORT);

  if (result.stage === "two-factor") {
    const query = new URLSearchParams({ channel: result.channel.toLowerCase() });
    if (returnTo) query.set("returnTo", returnTo);
    return {
      status: "verify" as const,
      message: `We sent a 6-digit code to ${result.channel === OtpChannel.EMAIL ? maskEmail(result.destination) : maskPhone(result.destination)}.`,
      maskedDestination: result.channel === OtpChannel.EMAIL ? maskEmail(result.destination) : maskPhone(result.destination),
      next: `/verify-two-factor?${query.toString()}`,
    };
  }

  // Password cleared but 2FA is not set up yet (freshly invited admin).
  const user = await resolveUserAfterPassword();
  if (!user) return { status: "error" as const, error: "Your account could not be loaded. Try again." };
  if (user.role.key === RoleKey.ADMIN || user.role.key === RoleKey.SUPER_ADMIN) {
    return { status: "activate" as const, next: "/two-factor-setup" };
  }
  return { status: "error" as const, error: "Two-factor authentication is required. Contact an administrator." };
}

/** Reads the user behind the pending-2FA cookie. */
async function resolveUserAfterPassword() {
  const pending = await readPendingTwoFactor();
  if (!pending) return null;
  return prisma.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, email: true, firstName: true, phone: true, role: { select: { key: true } }, twoFactorEnabledAt: true },
  });
}

/** Step 2: the second factor. */
export async function completeSignInAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z.object({ code: codeSchema, returnTo: z.string().optional() }).safeParse({
    code: str(formData, "code"),
    returnTo: str(formData, "returnTo") || undefined,
  });
  if (!parsed.success) return { status: "error" as const, error: "Enter the 6-digit code." };

  const pending = await readPendingTwoFactor();
  if (!pending) {
    await clearPendingTwoFactor();
    return { status: "error" as const, error: "Your sign-in attempt expired. Start again.", next: "/sign-in" };
  }

  const { ipAddress, deviceId } = await clientIdentity();
  if (!allowRequest(`otp:${ipAddress}`, 30, 10 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Wait a few minutes and try again." };
  }

  const result = await completeSignIn({ userId: pending.userId, code: parsed.data.code, ipAddress, deviceId });
  if (!result.ok) {
    return { status: "error" as const, error: result.message };
  }

  const user = await prisma.user.findUnique({ where: { id: pending.userId }, select: { role: { select: { key: true } } } });
  const returnTo = safeReturnTo(parsed.data.returnTo, ALLOWED_REPORT);
  const next = returnTo ?? HOME_BY_ROLE[user?.role.key ?? RoleKey.CUSTOMER];
  return { status: "done" as const, message: "Signed in.", next };
}

/**
 * Sends another OTP for a half-finished sign-in.
 *
 * The pending sign-in is identified by the HttpOnly cookie rather than by
 * anything in the form, so the parameters are intentionally unused.
 */
export async function resendTwoFactorAction(): Promise<AuthActionState> {
  const pending = await readPendingTwoFactor();
  if (!pending) return { status: "error" as const, error: "Your sign-in attempt expired. Start again." };

  const account = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, email: true, phone: true, twoFactorChannel: true },
  });
  if (!account) return { status: "error" as const, error: "Your sign-in attempt expired. Start again." };

  const channel = account.twoFactorChannel ?? OtpChannel.EMAIL;
  const ipAddress = await requestIp();
  const issued = await issueOtp({
    userId: account.id,
    email: account.email,
    phone: account.phone,
    channel,
    purpose: "TWO_FACTOR",
    ipAddress,
  });
  if (!issued.ok) return { status: "error" as const, error: issued.message };

  const masked = channel === OtpChannel.EMAIL ? maskEmail(issued.destination) : maskPhone(issued.destination);
  return { status: "verify" as const, message: `A new code is on its way to ${masked}.`, maskedDestination: masked };
}

/** Signs the current device out. */
export async function signOutAction(): Promise<never> {
  const context = await getAuthContext();
  await signOut(context.sessionId, context.user?.id ?? null);
  redirect("/");
}

/** Public "join the team" request. No sign-in required. */
export async function submitAccessRequestAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Enter your full name.").max(120),
      email: emailSchema,
      phone: z.string().trim().max(24).optional(),
      requestedRole: z.enum(["ADMIN", "STAFF"]),
      staffType: z.string().trim().max(40).optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .safeParse({
      fullName: str(formData, "fullName"),
      email: str(formData, "email"),
      phone: str(formData, "phone") || undefined,
      requestedRole: str(formData, "requestedRole"),
      staffType: str(formData, "staffType") || undefined,
      note: str(formData, "note") || undefined,
    });

  if (!parsed.success) return { status: "error" as const, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const ipAddress = await requestIp();
  // Tight throttle: this endpoint is public and mails a super admin on success.
  if (!allowRequest(`join-team:ip:${ipAddress}`, 5, 60 * 60_000)) {
    return { status: "error" as const, error: "Too many requests from this connection. Try again later." };
  }
  const emailKey = sha256(parsed.data.email);
  if (!allowRequest(`join-team:email:${emailKey}`, 3, 24 * 60 * 60_000)) {
    return { status: "error" as const, error: "You have already sent a request for this address. Check your email for the outcome." };
  }

  const context = await getAuthContext();
  const result = await submitAccessRequest({
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    requestedRole: parsed.data.requestedRole,
    staffType: (parsed.data.staffType as never) ?? null,
    note: parsed.data.note ?? null,
    requesterId: context.user?.id ?? null,
    ipAddress,
  });
  if (!result.ok) return { status: "error" as const, error: result.message };

  return {
    status: "success" as const,
    message: `Thanks ${parsed.data.fullName.split(/\s+/)[0]}. Your request was sent to the super admin. You will get an email once a decision is made. Nothing is granted until then.`,
  };
}

/** Redeems an activation link and sets the first password. */
export async function activateAccountAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z
    .object({ token: z.string().trim().min(20, "That link is not valid."), password: z.string().min(1, "Choose a password.").max(200), confirmPassword: z.string().max(200) })
    .refine((data) => data.password === data.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] })
    .safeParse({ token: str(formData, "token"), password: str(formData, "password"), confirmPassword: str(formData, "confirmPassword") });

  if (!parsed.success) return { status: "error" as const, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const ipAddress = await requestIp();
  if (!allowRequest(`activate:${ipAddress}`, 10, 60 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Try again later." };
  }

  const result = await activateWithToken({ token: parsed.data.token, password: parsed.data.password, ipAddress });
  if (!result.ok) return { status: "error" as const, error: result.message };

  const user = await prisma.user.findUnique({ where: { id: result.userId }, select: { role: { select: { key: true } } } });
  const privileged = user?.role.key === RoleKey.ADMIN || user?.role.key === RoleKey.SUPER_ADMIN;
  return {
    status: "activate" as const,
    message: "Password set. One more step to protect your account.",
    next: privileged ? `/two-factor-setup?user=${encodeURIComponent(result.userId)}` : "/sign-in",
  };
}

/** Sends the enrolment code for the chosen second factor. */
export async function startTwoFactorSetupAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const channel = str(formData, "channel");
  if (channel !== "EMAIL" && channel !== "PHONE") return { status: "error" as const, error: "Choose how you want to receive codes." };

  const context = await getAuthContext();
  // A member who has just activated has a session; otherwise trust the signed
  // pending-2FA cookie, which is only set after a correct password.
  let userId = context.user?.id ?? null;
  if (!userId) userId = (await readPendingTwoFactor())?.userId ?? null;
  if (!userId) return { status: "error" as const, error: "Sign in again before setting up two-factor authentication." };

  const phone = str(formData, "phone") || undefined;
  if (channel === "PHONE" && !isPhoneOtpEnabled()) {
    return { status: "error" as const, error: "Phone codes are not available. Use email instead." };
  }
  if (phone && !normalisePhone(phone)) return { status: "error" as const, error: "Enter a valid phone number.", fieldErrors: { phone: "Enter a valid phone number." } };

  const ipAddress = await requestIp();
  if (!allowRequest(`2fa-setup:${ipAddress}`, 10, 60 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Try again later." };
  }

  const result = await enableTwoFactor({ userId, channel: channel as OtpChannel, email: context.user?.email ?? "", phone: phone ?? null, ipAddress });
  if (!result.ok) return { status: "error" as const, error: result.message };

  const masked = channel === "EMAIL" ? maskEmail(result.destination) : maskPhone(result.destination);
  return { status: "verify" as const, message: `We sent a 6-digit code to ${masked}.`, maskedDestination: masked, next: `/two-factor-setup?channel=${channel.toLowerCase()}` };
}

/** Confirms the enrolment code and unlocks the account. */
export async function confirmTwoFactorSetupAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z.object({ code: codeSchema, channel: z.enum(["EMAIL", "PHONE"]) }).safeParse({ code: str(formData, "code"), channel: str(formData, "channel") });
  if (!parsed.success) return { status: "error" as const, error: "Enter the 6-digit code." };

  const context = await getAuthContext();
  let userId = context.user?.id ?? null;
  if (!userId) userId = (await readPendingTwoFactor())?.userId ?? null;
  if (!userId) return { status: "error" as const, error: "Sign in again before finishing two-factor setup." };

  const ipAddress = await requestIp();
  if (!allowRequest(`2fa-confirm:${ipAddress}`, 15, 30 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Try again later." };
  }

  const result = await confirmTwoFactor({ userId, channel: parsed.data.channel as OtpChannel, code: parsed.data.code, ipAddress });
  if (!result.ok) return { status: "error" as const, error: result.message };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: { select: { key: true } } } });
  const session = await issueSession({ userId, channel: parsed.data.channel as OtpChannel, ipAddress, deviceId: null });
  if (!session.ok) return { status: "error" as const, error: session.message };

  return { status: "done" as const, message: "Two-factor authentication is on.", next: HOME_BY_ROLE[user?.role.key ?? RoleKey.CUSTOMER] };
}

/** Self-service: revoke one of the account's other devices. */
export async function revokeDeviceAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const sessionId = str(formData, "sessionId");
  if (!sessionId) return { status: "error" as const, error: "That device could not be identified." };

  const context = await getAuthContext();
  if (!context.user) return { status: "error" as const, error: "Sign in again." };

  if (sessionId === context.sessionId) {
    return { status: "error" as const, error: "Use Sign out to end the session you are currently using." };
  }
  // Scoped by userId so a forged id cannot revoke somebody else's device.
  const result = await prisma.authSession.updateMany({
    where: { id: sessionId, userId: context.user.id, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "Revoked by the account owner." },
  });
  if (result.count !== 1) return { status: "error" as const, error: "That device is no longer signed in." };

  await recordSecurityEvent({ type: "DEVICE_SESSION_REVOKED", userId: context.user.id, detail: `Device session ${sessionId} revoked by the owner.` });
  return { status: "success" as const, message: "That device has been signed out." };
}

/** Self-service: sign out every other device. */
export async function revokeAllDevicesAction(): Promise<AuthActionState> {
  const context = await getAuthContext();
  if (!context.user) return { status: "error" as const, error: "Sign in again." };

  const token = await readSessionToken();
  const current = token ? await prisma.authSession.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true } }) : null;

  const revoked = await prisma.authSession.updateMany({
    where: { userId: context.user.id, status: "ACTIVE", ...(current ? { NOT: { id: current.id } } : {}) },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "Signed out everywhere else." },
  });
  await recordSecurityEvent({ type: "DEVICE_SESSION_REVOKED", userId: context.user.id, detail: `${revoked.count} other device(s) signed out by the owner.` });
  return { status: "success" as const, message: revoked.count > 0 ? `Signed out of ${revoked.count} other device${revoked.count === 1 ? "" : "s"}.` : "No other devices were signed in." };
}

/** Super admin: sign a team member out of all their devices. */
export async function revokeUserSessionsAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const { requireSuperAdminForAction } = await import("@/lib/auth/server");
  const reviewer = await requireSuperAdminForAction();
  const userId = str(formData, "userId");
  if (!userId || userId === reviewer.id) return { status: "error" as const, error: "Choose another team member." };

  const count = await revokeAllSessions(userId, "Signed out by a super admin.");
  return { status: "success" as const, message: count > 0 ? `Signed out of ${count} device${count === 1 ? "" : "s"}.` : "That account had no active devices." };
}

/** Super admin: re-send an activation link to a team member who has not used it. */
export async function resendTeamInviteAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const { requireSuperAdminForAction } = await import("@/lib/auth/server");
  await requireSuperAdminForAction();
  const userId = str(formData, "userId");
  if (!userId) return { status: "error" as const, error: "That team member could not be identified." };

  const result = await resendTeamInvite(userId);
  if (!result.ok) return { status: "error" as const, error: result.message };
  return { status: "success" as const, message: result.message, next: result.activationUrl };
}

// ------------------------------------------------------------- own credentials

/**
 * Self-service credential changes for a first-party account.
 *
 * Holding an unlocked session is not the same as owning the account, so both
 * operations re-check the current password before anything is written. A new
 * address is only applied once a code sent to *that* address has come back, and
 * the address itself is read out of the stored challenge rather than trusted from
 * the form, so a tampered field cannot aim the change somewhere else. The code is
 * bound to the session that asked for it, so it cannot be redeemed on another
 * device.
 */

/** Returns the context only for an account that owns a local password. */
async function requireFirstPartyContext() {
  const context = await getAuthContext();
  if (!context.user || !context.sessionId) return null;
  // Customers hold no password: they authenticate with the sign-in provider,
  // which owns their address.
  if (context.user.role === RoleKey.CUSTOMER) return null;
  return context;
}

const WRONG_CURRENT_PASSWORD = { status: "error" as const, error: "That current password is not correct." };
const NEEDS_SIGN_IN = { status: "error" as const, error: "Sign in again to change your credentials." };

/** Step 1: confirm the current password, then send a code to the new address. */
export async function startEmailChangeAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z
    .object({ newEmail: emailSchema, currentPassword: passwordSchema })
    .safeParse({ newEmail: str(formData, "newEmail"), currentPassword: str(formData, "currentPassword") });
  if (!parsed.success) return { status: "error" as const, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const context = await requireFirstPartyContext();
  if (!context?.user || !context.sessionId) return NEEDS_SIGN_IN;

  const ipAddress = await requestIp();
  if (!allowRequest(`email-change:${context.user.id}`, 5, 60 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Wait a few minutes and try again." };
  }

  const account = await prisma.user.findUnique({ where: { id: context.user.id }, select: { passwordHash: true, email: true } });
  if (!account?.passwordHash) return { status: "error" as const, error: "This account has no password to confirm." };

  if (!verifyPassword(parsed.data.currentPassword, account.passwordHash)) {
    await recordSecurityEvent({ type: "CREDENTIAL_CHANGE_BLOCKED", userId: context.user.id, ipAddress, detail: "Email change refused: the current password did not match." });
    return WRONG_CURRENT_PASSWORD;
  }

  const newEmail = parsed.data.newEmail;
  if (newEmail === account.email) return { status: "error" as const, error: "That is already your email address." };

  const taken = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (taken && taken.id !== context.user.id) return { status: "error" as const, error: "That email address is already in use." };

  const issued = await issueOtp({
    userId: context.user.id,
    email: newEmail,
    phone: null,
    channel: OtpChannel.EMAIL,
    purpose: OtpPurpose.EMAIL_VERIFY,
    boundSessionId: context.sessionId,
    ipAddress,
  });
  if (!issued.ok) return { status: "error" as const, error: issued.message };

  return {
    status: "verify" as const,
    message: `We sent a 6-digit code to ${maskEmail(issued.destination)}. Enter it to confirm the change.`,
    maskedDestination: maskEmail(issued.destination),
  };
}

/** Step 2: the code proves control of the new address, so the swap is applied. */
export async function confirmEmailChangeAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z.object({ code: codeSchema }).safeParse({ code: str(formData, "code") });
  if (!parsed.success) return { status: "error" as const, error: "Enter the 6-digit code." };

  const context = await requireFirstPartyContext();
  if (!context?.user || !context.sessionId) return NEEDS_SIGN_IN;

  // The destination is read from the challenge this session created, so the form
  // never has to name the address being moved to.
  const pending = await prisma.otpChallenge.findFirst({
    where: { userId: context.user.id, purpose: OtpPurpose.EMAIL_VERIFY, boundSessionId: context.sessionId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { destination: true },
  });
  if (!pending) return { status: "error" as const, error: "Request a new code to continue." };

  try {
    await verifyOtp({ userId: context.user.id, destination: pending.destination, purpose: OtpPurpose.EMAIL_VERIFY, code: parsed.data.code, boundSessionId: context.sessionId });
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : "That code is not correct." };
  }

  // The address could have been claimed by someone else while the code was in
  // flight, so uniqueness is re-checked at the moment of the write.
  const clash = await prisma.user.findUnique({ where: { email: pending.destination }, select: { id: true } });
  if (clash && clash.id !== context.user.id) {
    return { status: "error" as const, error: "That email address was taken while the code was on its way. Start again." };
  }

  await prisma.user.update({ where: { id: context.user.id }, data: { email: pending.destination, emailVerifiedAt: new Date() } });
  await recordSecurityEvent({ type: "EMAIL_CHANGED", userId: context.user.id, ipAddress: await requestIp(), detail: "Email address changed and confirmed by a code sent to the new address." });

  return { status: "success" as const, message: `Your email address is now ${maskEmail(pending.destination)}.` };
}

/** Replaces the password after re-confirming the current one. */
export async function updatePasswordAction(_prev: unknown, formData: FormData): Promise<AuthActionState> {
  const parsed = z
    .object({
      currentPassword: passwordSchema,
      newPassword: z.string().min(1, "Choose a password.").max(200),
      confirmPassword: z.string().max(200),
    })
    .refine((data) => data.newPassword === data.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] })
    .safeParse({
      currentPassword: str(formData, "currentPassword"),
      newPassword: str(formData, "newPassword"),
      confirmPassword: str(formData, "confirmPassword"),
    });
  if (!parsed.success) return { status: "error" as const, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const context = await requireFirstPartyContext();
  if (!context?.user || !context.sessionId) return NEEDS_SIGN_IN;

  const ipAddress = await requestIp();
  if (!allowRequest(`password-change:${context.user.id}`, 5, 60 * 60_000)) {
    return { status: "error" as const, error: "Too many attempts. Wait a few minutes and try again." };
  }

  const account = await prisma.user.findUnique({
    where: { id: context.user.id },
    select: { passwordHash: true, email: true, firstName: true, lastName: true },
  });
  if (!account?.passwordHash) return { status: "error" as const, error: "This account has no password to change." };

  if (!verifyPassword(parsed.data.currentPassword, account.passwordHash)) {
    await recordSecurityEvent({ type: "CREDENTIAL_CHANGE_BLOCKED", userId: context.user.id, ipAddress, detail: "Password change refused: the current password did not match." });
    return WRONG_CURRENT_PASSWORD;
  }
  if (verifyPassword(parsed.data.newPassword, account.passwordHash)) {
    return { status: "error" as const, error: "Choose a password you have not used on this account before." };
  }

  const policy = await assertPasswordAcceptable(parsed.data.newPassword, { email: account.email, name: `${account.firstName} ${account.lastName ?? ""}` });
  if (!policy.ok) return { status: "error" as const, error: policy.message, fieldErrors: { newPassword: policy.message } };

  await prisma.user.update({
    where: { id: context.user.id },
    data: { passwordHash: hashPassword(parsed.data.newPassword), passwordChangedAt: new Date(), mustSetPassword: false },
  });

  // Every other device is signed out. Changing the password is how someone takes
  // an account back from whoever else was using it, so a change that leaves the
  // old sessions alive would defeat the point.
  const revoked = await prisma.authSession.updateMany({
    where: { userId: context.user.id, status: "ACTIVE", id: { not: context.sessionId } },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "Password changed by the account owner." },
  });
  await recordSecurityEvent({
    type: "PASSWORD_CHANGED",
    userId: context.user.id,
    ipAddress,
    detail: `Password changed by the owner; ${revoked.count} other device(s) signed out.`,
  });

  return {
    status: "success" as const,
    message: revoked.count > 0 ? `Password updated and ${revoked.count} other device${revoked.count === 1 ? "" : "s"} signed out.` : "Password updated.",
  };
}
