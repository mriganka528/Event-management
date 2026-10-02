import "server-only";

import { AccountStatus, AdminRequestStatus, OtpChannel, OtpPurpose, RoleKey, StaffStatus, StaffType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertPasswordAcceptable, generateToken, hashPassword, sha256 } from "@/lib/auth/password";
import { issueOtp, verifyOtp } from "@/lib/auth/otp";
import { isPhoneOtpEnabled, normalisePhone } from "@/lib/auth/sms";
import { notifyAdmins, notifyUser } from "@/lib/notifications";
import { sendAccessDeclinedEmail, sendAccessRequestReceivedEmail, sendTeamInviteEmail, teamInviteExpiresAt } from "@/lib/mailer";
import { isAdminRole } from "@/lib/access-policy";
import { recordSecurityEvent } from "@/lib/security-audit";
import { withSerializableRetry } from "@/lib/transactions";
import { listAdminRecipients } from "@/lib/notifications";
import { NotificationType } from "@prisma/client";

/**
 * Team membership: the public "join the team" request, the super admin's
 * decision, and the activation flow that turns an approved request into a
 * working account.
 *
 * Key property: an access request needs NO account and NO sign-in. Anyone can
 * apply from the public page, a super admin is notified and decides, and only an
 * approval creates any credential.
 */

export class TeamError extends Error {}

const REQUESTABLE_ROLES = [RoleKey.ADMIN, RoleKey.STAFF] as const;

export type AccessRequestInput = {
  fullName: string;
  email: string;
  phone?: string | null;
  requestedRole: "ADMIN" | "STAFF";
  staffType?: StaffType | null;
  note?: string | null;
  /** Present when a signed-in user submits the form. */
  requesterId?: string | null;
  ipAddress: string | null;
};

/** Public access-request submission. No authentication required. */
export async function submitAccessRequest(input: AccessRequestInput): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, message: "Enter a valid email address." };
  }
  const fullName = input.fullName.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, message: "Enter your full name." };
  }
  if (!REQUESTABLE_ROLES.includes(input.requestedRole as (typeof REQUESTABLE_ROLES)[number])) {
    return { ok: false, message: "Choose a valid role." };
  }
  if (input.requestedRole === "STAFF" && !input.staffType) {
    return { ok: false, message: "Choose a staff role." };
  }

  const existingAccount = await prisma.user.findUnique({ where: { email }, select: { id: true, role: { select: { key: true } }, isActive: true } });
  if (existingAccount) {
    if (existingAccount.role.key === RoleKey.ADMIN || existingAccount.role.key === RoleKey.SUPER_ADMIN) {
      return { ok: false, message: "You already have administrator access. Sign in instead." };
    }
    if (existingAccount.role.key === RoleKey.STAFF) {
      return { ok: false, message: "You are already on the team. Sign in instead." };
    }
  }

  const duplicate = await prisma.adminAccessRequest.findFirst({ where: { email, status: AdminRequestStatus.PENDING } });
  if (duplicate) {
    return { ok: false, message: "You already have a request awaiting review." };
  }

  const request = await prisma.adminAccessRequest.create({
    data: {
      requesterId: input.requesterId ?? null,
      email,
      fullName,
      phone: input.phone ? normalisePhone(input.phone) : null,
      requestedRole: input.requestedRole === "STAFF" ? RoleKey.STAFF : RoleKey.ADMIN,
      staffType: input.requestedRole === "STAFF" ? (input.staffType ?? StaffType.DECORATOR) : null,
      note: input.note?.trim().slice(0, 1000) || null,
    },
    select: { id: true },
  });

  await recordSecurityEvent({ type: "ACCESS_REQUEST_SUBMITTED", email, ipAddress: input.ipAddress, detail: `${input.requestedRole} access requested from the public form.` });

  const roleLabel = input.requestedRole === "STAFF" ? "staff" : "admin";
  await notifyAdmins({
    type: NotificationType.STAFF_REQUEST,
    title: `New ${roleLabel} access request`,
    message: `${fullName} (${email}) asked to join the team as ${roleLabel}.`,
    href: "/admin/admins",
  });

  // Notify the super admins by email as well, since the requester cannot see the
  // in-app inbox.
  const superAdmins = await prisma.user.findMany({
    where: { isActive: true, accountStatus: AccountStatus.ACTIVE, role: { key: RoleKey.SUPER_ADMIN } },
    select: { email: true, firstName: true },
  });
  await Promise.all(
    superAdmins.map((admin) =>
      sendAccessRequestReceivedEmail({ to: admin.email, requesterName: fullName, requesterEmail: email, requestedRole: roleLabel }).catch(() => undefined),
    ),
  );

  return { ok: true, id: request.id };
}

/**
 * Approves a request and provisions the account.
 *
 * The new member receives a single-use activation link, chooses their own
 * password, and must set up a second factor before they can reach any page.
 */
export type ProvisionResult = { ok: true; userId: string; email: string; activationUrl?: string } | { ok: false; message: string };

export async function approveAccessRequest(input: {
  requestId: string;
  reviewer: { id: string; role: RoleKey; firstName: string; lastName: string | null };
  staffType?: StaffType | null;
  reviewNote?: string | null;
  ipAddress: string | null;
}): Promise<ProvisionResult> {
  const request = await prisma.adminAccessRequest.findUnique({ where: { id: input.requestId } });
  if (!request) return { ok: false, message: "That request no longer exists." };
  if (request.status !== AdminRequestStatus.PENDING) return { ok: false, message: "This access request has already been reviewed." };
  if (request.requesterId && request.requesterId === input.reviewer.id) return { ok: false, message: "You cannot review your own request." };
  if (request.requestedRole === RoleKey.ADMIN && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    return { ok: false, message: "Only a super admin can approve administrator access." };
  }

  const targetRole = request.requestedRole;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: targetRole } });
  const email = request.email;
  const [firstName, ...rest] = request.fullName.split(/\s+/);

  const token = generateToken(32);
  const expiresAt = teamInviteExpiresAt();

  const user = await withSerializableRetry(async (tx) => {
    // Compare-and-set so two reviewers cannot both approve the same request.
    const claimed = await tx.adminAccessRequest.updateMany({
      where: { id: input.requestId, status: AdminRequestStatus.PENDING },
      data: { status: AdminRequestStatus.APPROVED, reviewedById: input.reviewer.id, reviewedAt: new Date(), reviewNote: input.reviewNote?.slice(0, 500) ?? null, ...(input.staffType ? { staffType: input.staffType } : {}) },
    });
    if (claimed.count !== 1) throw new TeamError("This access request has already been reviewed.");

    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    const account = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { roleId: role.id, isActive: true, accountStatus: AccountStatus.ACTIVE, approvedAt: new Date(), approvedById: input.reviewer.id, suspendedAt: null, suspensionReason: null },
          select: { id: true },
        })
      : await tx.user.create({
          data: {
            email,
            firstName: firstName ?? request.fullName,
            lastName: rest.join(" ") || null,
            phone: request.phone,
            roleId: role.id,
            accountStatus: AccountStatus.ACTIVE,
            approvedAt: new Date(),
            approvedById: input.reviewer.id,
            // No credential yet: the member activates with the emailed link.
            mustSetPassword: true,
            emailVerifiedAt: new Date(),
          },
          select: { id: true },
        });

    await tx.activationToken.create({ data: { userId: account.id, tokenHash: sha256(token), expiresAt } });

    if (targetRole === RoleKey.ADMIN) {
      await tx.admin.upsert({ where: { userId: account.id }, update: {}, create: { userId: account.id } });
    } else {
      await tx.staff.upsert({
        where: { userId: account.id },
        update: { staffType: input.staffType ?? request.staffType ?? StaffType.DECORATOR, status: StaffStatus.PENDING, inviteToken: null, inviteExpiresAt: null },
        create: { userId: account.id, staffType: input.staffType ?? request.staffType ?? StaffType.DECORATOR, status: StaffStatus.PENDING },
      });
    }

    await tx.adminAccessRequest.update({ where: { id: input.requestId }, data: { userId: account.id } });
    return { id: account.id };
  });

  const roleLabel = targetRole === RoleKey.STAFF ? "staff" : "admin";
  const { absoluteUrl } = await import("@/lib/site");
  const activateUrl = absoluteUrl(`/activate?token=${encodeURIComponent(token)}`);

  await recordSecurityEvent({ type: "ACCESS_REQUEST_APPROVED", userId: user.id, email, ipAddress: input.ipAddress, detail: `Approved as ${roleLabel} by reviewer ${input.reviewer.id}.` });
  await notifyUser(user.id, {
    type: NotificationType.STAFF_ACTIVATED,
    title: "Access approved",
    message: `An administrator approved your ${roleLabel} access. Use the link in your email to set a password and two-factor authentication.`,
    href: "/sign-in",
  });
  const mail = await sendTeamInviteEmail({
    to: email,
    firstName: firstName ?? "there",
    role: roleLabel,
    invitedBy: [input.reviewer.firstName, input.reviewer.lastName].filter(Boolean).join(" ") || "An administrator",
    activateUrl,
  });

  if (!mail.sent) {
    // The mailer is not configured yet, so hand the link back so the super admin
    // can share it manually instead of leaving the member stranded.
    return { ok: true, userId: user.id, email, activationUrl: activateUrl };
  }
  return { ok: true, userId: user.id, email };
}

export async function rejectAccessRequest(input: {
  requestId: string;
  reviewer: { id: string; role: RoleKey };
  reviewNote?: string | null;
  ipAddress: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const request = await prisma.adminAccessRequest.findUnique({ where: { id: input.requestId } });
  if (!request) return { ok: false, message: "That request no longer exists." };
  if (request.status !== AdminRequestStatus.PENDING) return { ok: false, message: "This access request has already been reviewed." };
  if (request.requestedRole === RoleKey.ADMIN && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    return { ok: false, message: "Only a super admin can decline administrator access." };
  }

  await prisma.adminAccessRequest.update({
    where: { id: input.requestId },
    data: { status: AdminRequestStatus.REJECTED, reviewedById: input.reviewer.id, reviewedAt: new Date(), reviewNote: input.reviewNote?.slice(0, 500) ?? null },
  });

  await recordSecurityEvent({ type: "ACCESS_REQUEST_REJECTED", email: request.email, ipAddress: input.ipAddress, detail: `Declined by reviewer ${input.reviewer.id}.` });
  await sendAccessDeclinedEmail({ to: request.email, firstName: request.fullName.split(/\s+/)[0] ?? "there" }).catch(() => undefined);
  return { ok: true };
}

/** Super admin creates a team member directly, with no request needed. */
export async function inviteTeamMember(input: {
  reviewer: { id: string; role: RoleKey; firstName: string; lastName: string | null };
  fullName: string;
  email: string;
  phone?: string | null;
  role: "ADMIN" | "STAFF";
  staffType?: StaffType | null;
  ipAddress: string | null;
}): Promise<ProvisionResult> {
  if (input.role === "ADMIN" && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    return { ok: false, message: "Only a super admin can create an administrator." };
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, message: "Enter a valid email address." };
  const fullName = input.fullName.trim();
  if (fullName.length < 2 || fullName.length > 120) return { ok: false, message: "Enter their full name." };
  if (input.role === "STAFF" && !input.staffType) return { ok: false, message: "Choose a staff role." };

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: { select: { key: true } } } });
  if (existing) return { ok: false, message: "An account already exists for that email address." };

  const role = await prisma.role.findUniqueOrThrow({ where: { key: input.role === "STAFF" ? RoleKey.STAFF : RoleKey.ADMIN } });
  const token = generateToken(32);
  const expiresAt = teamInviteExpiresAt();
  const [firstName, ...rest] = fullName.split(/\s+/);

  const user = await withSerializableRetry(async (tx) => {
    const account = await tx.user.create({
      data: {
        email,
        firstName: firstName ?? fullName,
        lastName: rest.join(" ") || null,
        phone: input.phone ? normalisePhone(input.phone) : null,
        roleId: role.id,
        accountStatus: AccountStatus.PENDING_APPROVAL,
        approvedAt: new Date(),
        approvedById: input.reviewer.id,
        mustSetPassword: true,
        emailVerifiedAt: new Date(),
        ...(input.role === "ADMIN"
          ? { adminProfile: { create: {} } }
          : { staffProfile: { create: { staffType: input.staffType ?? StaffType.DECORATOR, status: StaffStatus.PENDING } } }),
      },
      select: { id: true },
    });
    await tx.activationToken.create({ data: { userId: account.id, tokenHash: sha256(token), expiresAt } });
    return account;
  });

  const { absoluteUrl } = await import("@/lib/site");
  const activateUrl = absoluteUrl(`/activate?token=${encodeURIComponent(token)}`);
  const roleLabel = input.role === "STAFF" ? "staff" : "admin";

  await recordSecurityEvent({ type: "STAFF_INVITED", userId: user.id, email, ipAddress: input.ipAddress, detail: `${roleLabel} invited directly by reviewer ${input.reviewer.id}.` });
  await notifyUser(user.id, {
    type: NotificationType.STAFF_INVITE,
    title: "Activate your account",
    message: `An administrator added you as ${roleLabel}. Use the link in your email to set a password and two-factor authentication.`,
    href: "/activate",
  });

  const mail = await sendTeamInviteEmail({
    to: email,
    firstName: firstName ?? "there",
    role: roleLabel,
    invitedBy: [input.reviewer.firstName, input.reviewer.lastName].filter(Boolean).join(" ") || "An administrator",
    activateUrl,
  });

  // When the mailer is unavailable the link is returned so the reviewer can
  // pass it on manually rather than leaving the member with no way in.
  return mail.sent ? { ok: true, userId: user.id, email } : { ok: true, userId: user.id, email, activationUrl: activateUrl };
}

/** Issues a fresh activation link for a member who has not activated yet. */
export async function resendTeamInvite(userId: string): Promise<{ ok: true; message: string; activationUrl?: string } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, passwordHash: true, role: { select: { key: true } } },
  });
  if (!user) return { ok: false, message: "That team member no longer exists." };
  if (user.passwordHash) return { ok: false, message: "That account is already activated." };

  // Invalidate any outstanding link so only the newest one works.
  await prisma.activationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });

  const token = generateToken(32);
  await prisma.activationToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: teamInviteExpiresAt() } });

  const { absoluteUrl } = await import("@/lib/site");
  const activateUrl = absoluteUrl(`/activate?token=${encodeURIComponent(token)}`);
  const roleLabel = user.role.key === RoleKey.STAFF ? "staff" : user.role.key === RoleKey.CUSTOMER ? "customer" : "admin";

  const mail = await sendTeamInviteEmail({ to: user.email, firstName: user.firstName, role: roleLabel, invitedBy: "An administrator", activateUrl });
  await recordSecurityEvent({ type: "STAFF_INVITED", userId, email: user.email, detail: "Activation link re-sent." });

  return mail.sent
    ? { ok: true, message: `A new activation link was sent to ${user.email}.` }
    : { ok: true, message: "The mailer is not configured, so the link could not be emailed. Share it manually.", activationUrl: activateUrl };
}

export type ActivationResult =
  | { ok: true; userId: string; email: string; firstName: string; role: RoleKey; requiresTwoFactor: boolean; phone: string | null; phoneOtpAvailable: boolean }
  | { ok: false; code: "INVALID" | "EXPIRED" | "USED"; message: string };

/** Validates an activation token without consuming it, for rendering the form. */
export async function inspectActivationToken(rawToken: string): Promise<ActivationResult> {
  if (!rawToken || rawToken.length < 20) return { ok: false, code: "INVALID", message: "That activation link is not valid." };
  const record = await prisma.activationToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!record) return { ok: false, code: "INVALID", message: "That activation link is not valid." };
  if (record.usedAt) return { ok: false, code: "USED", message: "That activation link has already been used. Request a new invitation." };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, code: "EXPIRED", message: "That activation link has expired. Ask an administrator to send a new one." };

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, firstName: true, phone: true, phoneVerifiedAt: true, twoFactorEnabledAt: true, role: { select: { key: true } } },
  });
  if (!user) return { ok: false, code: "INVALID", message: "That activation link is not valid." };

  const privileged = user.role.key === RoleKey.ADMIN || user.role.key === RoleKey.SUPER_ADMIN;
  return {
    ok: true,
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    role: user.role.key,
    requiresTwoFactor: privileged,
    phone: user.phone,
    phoneOtpAvailable: Boolean(user.phone && user.phoneVerifiedAt && isPhoneOtpEnabled()),
  };
}

/** Redeems an activation token by setting the first password. */
export async function activateWithToken(input: { token: string; password: string; ipAddress: string | null }): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const inspected = await inspectActivationToken(input.token);
  if (!inspected.ok) return { ok: false, message: inspected.message };

  const policy = await assertPasswordAcceptable(input.password, { email: inspected.email, name: inspected.firstName });
  if (!policy.ok) return { ok: false, message: policy.message };

  const tokenHash = sha256(input.token);
  const claimed = await prisma.activationToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, message: "That activation link has already been used." };

  await prisma.user.update({
    where: { id: inspected.userId },
    data: { passwordHash: hashPassword(input.password), passwordChangedAt: new Date(), mustSetPassword: false },
  });
  await recordSecurityEvent({ type: "PASSWORD_CHANGED", userId: inspected.userId, email: inspected.email, ipAddress: input.ipAddress, detail: "Password set from an activation link." });
  return { ok: true, userId: inspected.userId };
}

/** Completes 2FA enrolment and unlocks the account. */
export async function enableTwoFactor(input: {
  userId: string;
  channel: OtpChannel;
  email: string;
  phone?: string | null;
  ipAddress: string | null;
}): Promise<{ ok: true; destination: string } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, phone: true, role: { select: { key: true } } } });
  if (!user) return { ok: false, message: "Your account could not be loaded." };

  if (input.channel === OtpChannel.PHONE) {
    if (!isPhoneOtpEnabled()) return { ok: false, message: "Phone codes are not available. Use email instead." };
    const phone = normalisePhone(input.phone ?? user.phone ?? "");
    if (!phone) return { ok: false, message: "Enter a valid phone number." };

    const issued = await issueOtp({ userId: user.id, email: user.email, phone, channel: OtpChannel.PHONE, purpose: OtpPurpose.PHONE_VERIFY, ipAddress: input.ipAddress });
    if (!issued.ok) return { ok: false, message: issued.message };
    return { ok: true, destination: issued.destination };
  }

  const issued = await issueOtp({ userId: user.id, email: user.email, channel: OtpChannel.EMAIL, purpose: OtpPurpose.TWO_FACTOR, ipAddress: input.ipAddress });
  if (!issued.ok) return { ok: false, message: issued.message };
  return { ok: true, destination: issued.destination };
}

/** Confirms the chosen second factor and marks 2FA as enforced. */
export async function confirmTwoFactor(input: { userId: string; channel: OtpChannel; code: string; ipAddress: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, phone: true } });
  if (!user) return { ok: false, message: "Your account could not be loaded." };

  const destination = input.channel === OtpChannel.EMAIL ? user.email : (normalisePhone(user.phone ?? "") ?? "");
  const purpose = input.channel === OtpChannel.EMAIL ? OtpPurpose.TWO_FACTOR : OtpPurpose.PHONE_VERIFY;
  try {
    await verifyOtp({ userId: user.id, destination, purpose, code: input.code });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "That code is not correct." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorChannel: input.channel,
      twoFactorEnabledAt: new Date(),
      ...(input.channel === OtpChannel.PHONE ? { phoneVerifiedAt: new Date() } : {}),
      // Enrolment is the last gate, so the account becomes usable now.
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  if (input.channel === OtpChannel.EMAIL) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.email ? new Date() : null } }).catch(() => undefined);

  await recordSecurityEvent({ type: "TWO_FACTOR_VERIFIED", userId: user.id, email: user.email, ipAddress: input.ipAddress, detail: `Two-factor enabled over ${input.channel.toLowerCase()}.` });
  return { ok: true };
}

export async function pendingAccessRequests() {
  return prisma.adminAccessRequest.findMany({
    where: { status: AdminRequestStatus.PENDING },
    orderBy: { createdAt: "asc" },
    include: { reviewedBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function teamDirectory() {
  return prisma.user.findMany({
    where: { role: { key: { in: [RoleKey.SUPER_ADMIN, RoleKey.ADMIN, RoleKey.STAFF] } } },
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true,
      accountStatus: true, twoFactorChannel: true, twoFactorEnabledAt: true, lastLoginAt: true, createdAt: true,
      role: { select: { key: true, name: true } },
      staffProfile: { select: { status: true, staffType: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export { listAdminRecipients, isAdminRole, randomUUID };
