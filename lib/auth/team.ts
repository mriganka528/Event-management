import "server-only";

import { AccountStatus, AdminRequestStatus, OtpChannel, OtpPurpose, RoleKey, StaffStatus, StaffType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
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
import { revokeAllSessions } from "@/lib/auth/session";
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

/** What the applicant actually asked for, echoed back on the confirmation screen. */
export type SubmittedAccessRequest = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  requestedRole: RoleKey;
  requestedStaffType: StaffType | null;
  note: string | null;
  createdAt: Date;
  /** Only set when the row has already been decided. */
  status?: AdminRequestStatus;
  reviewedAt?: Date | null;
};

export type AccessRequestOutcome =
  | { ok: true; request: SubmittedAccessRequest }
  | { ok: false; message: string; previous: SubmittedAccessRequest | null };

const REQUEST_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  requestedRole: true,
  staffType: true,
  note: true,
  createdAt: true,
  status: true,
  reviewedAt: true,
} as const;

/** The stored shape every request is read back in. */
type RequestRow = Parameters<typeof toSubmittedRequest>[0];

/**
 * Flattens a stored request into the shape the applicant is shown.
 *
 * Used for both the confirmation and the refusal, so the applicant always sees
 * the same fields whether their request went through or was turned down as a
 * duplicate — the two used to be completely different screens.
 */
function toSubmittedRequest(row: {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  requestedRole: RoleKey;
  staffType: StaffType | null;
  note: string | null;
  createdAt: Date;
  status: AdminRequestStatus;
  reviewedAt: Date | null;
}): SubmittedAccessRequest {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    requestedRole: row.requestedRole,
    requestedStaffType: row.staffType,
    note: row.note,
    createdAt: row.createdAt,
    status: row.status,
    reviewedAt: row.reviewedAt,
  };
}

/** Public access-request submission. No authentication required. */
export async function submitAccessRequest(input: AccessRequestInput): Promise<AccessRequestOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, message: "Enter a valid email address.", previous: null };
  }
  const fullName = input.fullName.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, message: "Enter your full name.", previous: null };
  }
  if (!REQUESTABLE_ROLES.includes(input.requestedRole as (typeof REQUESTABLE_ROLES)[number])) {
    return { ok: false, message: "Choose a valid role.", previous: null };
  }
  const staffType = input.requestedRole === "STAFF" ? input.staffType ?? null : null;
  // A staff request with no staff type would be approved into an arbitrary role,
  // so it is refused here rather than defaulted. Defaulting is what silently
  // filed a driver as a decorator, and the applicant never found out.
  if (input.requestedRole === "STAFF" && !staffType) {
    return { ok: false, message: "Choose the staff role you are applying for.", previous: null };
  }
  if (staffType && !Object.values(StaffType).includes(staffType)) {
    return { ok: false, message: "Choose a valid staff role.", previous: null };
  }

  const existingAccount = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      isActive: true,
      accountStatus: true,
      role: { select: { key: true } },
      staffProfile: { select: { status: true } },
    },
  });
  if (existingAccount) {
    if (existingAccount.role.key === RoleKey.ADMIN || existingAccount.role.key === RoleKey.SUPER_ADMIN) {
      return { ok: false, message: "You already have administrator access. Sign in instead.", previous: null };
    }

    const staffProfile = existingAccount.staffProfile;
    const removedStaff = staffProfile?.status === StaffStatus.SUSPENDED;
    // ACTIVE and PENDING staff profiles both mean the team already has a live
    // record for this address. A suspended profile is the exception: removal
    // keeps that row so the previous assignments survive, and the person is
    // deliberately allowed to apply again.
    const currentTeamMember =
      (staffProfile !== null && staffProfile.status !== StaffStatus.SUSPENDED) ||
      (existingAccount.role.key === RoleKey.STAFF && staffProfile === null);
    if (currentTeamMember) {
      return { ok: false, message: "You are already on the team. Sign in instead.", previous: null };
    }

    if (existingAccount.accountStatus === AccountStatus.REJECTED) {
      return { ok: false, message: "This account was not accepted. Contact a super admin if you think that was a mistake.", previous: null };
    }
    // A suspended account with no staff history is not a removed staff member;
    // suspension is an administrative decision and re-applying must not be a
    // way around it. A removed staff member has a suspended staff profile and
    // is allowed through.
    if (existingAccount.accountStatus === AccountStatus.SUSPENDED && !removedStaff) {
      return { ok: false, message: "This account is suspended. Contact a super admin to have it reviewed.", previous: null };
    }
  }

  // One live request per address. Only a request that is still waiting blocks a
  // new one: an approved request does not, because the account may have been
  // removed since (or may have been a customer who is now applying to join the
  // team). A rejected request may be re-submitted. The existing-account check
  // above is what stops a current team member from applying again.
  //
  // The check and the insert share one serializable transaction on purpose: two
  // submissions fired in the same instant would both read "no open request" and
  // both insert, and the duplicate would sit in the queue invisibly.
  // The transaction's result is a discriminated union rather than an object
  // that is either `{refused}` or `{created}`. A shape-optional result has to be
  // tested with `in`, which then leaves the compiler unable to prove which
  // properties are present on the side it narrowed to.
  type Attempt =
    | { outcome: "refused"; previous: RequestRow }
    | { outcome: "created"; request: RequestRow };

  const attempted: Attempt = await withSerializableRetry<Attempt>(async (tx) => {
    const previous = await tx.adminAccessRequest.findFirst({
      where: { email },
      orderBy: { createdAt: "desc" },
      select: REQUEST_SELECT,
    });
    if (previous && previous.status === AdminRequestStatus.PENDING) {
      return { outcome: "refused", previous };
    }

    return {
      outcome: "created",
      request: await tx.adminAccessRequest.create({
        data: {
          requesterId: input.requesterId ?? null,
          email,
          fullName,
          phone: input.phone ? normalisePhone(input.phone) : null,
          requestedRole: input.requestedRole === "STAFF" ? RoleKey.STAFF : RoleKey.ADMIN,
          staffType,
          note: input.note?.trim().slice(0, 1000) || null,
        },
        select: REQUEST_SELECT,
      }),
    };
  });

  if (attempted.outcome === "refused") {
    const previous = attempted.previous;
    // The refusal carries the earlier request back with it. "You already have a
    // request awaiting review" on its own left the applicant with no way to see
    // what was submitted, which is the same dead end as the confirmation that
    // showed nothing. Only a PENDING request reaches this branch.
    return {
      ok: false,
      message: "You already have a request awaiting review. We will email you once a decision is made.",
      previous: toSubmittedRequest(previous),
    };
  }

  const created = attempted.request;

  await recordSecurityEvent({
    type: "ACCESS_REQUEST_SUBMITTED",
    email,
    ipAddress: input.ipAddress,
    // The staff type is part of what was asked for, so it belongs in the audit
    // trail and not only in the row.
    detail: `${input.requestedRole} access requested from the public form${staffType ? ` as ${staffType}` : ""}.`,
  });

  const roleLabel = input.requestedRole === "STAFF" ? "staff" : "admin";
  const staffLabel = staffType ? staffType.toLowerCase().replaceAll("_", " ") : null;
  await notifyAdmins({
    type: NotificationType.STAFF_REQUEST,
    title: `New ${roleLabel} access request`,
    message: staffLabel
      ? `${fullName} (${email}) asked to join the team as ${staffLabel}.`
      : `${fullName} (${email}) asked to join the team as ${roleLabel}.`,
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
      sendAccessRequestReceivedEmail({
        to: admin.email,
        requesterName: fullName,
        requesterEmail: email,
        requestedRole: roleLabel,
        requestedStaffType: staffLabel,
      }).catch(() => undefined),
    ),
  );

  return { ok: true, request: toSubmittedRequest(created) };
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
  // The request and the two roles it could possibly need are independent reads;
  // fetch them together instead of serialising a second round trip on Neon.
  const [request, roles] = await Promise.all([
    prisma.adminAccessRequest.findUnique({ where: { id: input.requestId } }),
    prisma.role.findMany({
      where: { key: { in: [...REQUESTABLE_ROLES] } },
      select: { id: true, key: true },
    }),
  ]);
  if (!request) return { ok: false, message: "That request no longer exists." };
  if (request.status !== AdminRequestStatus.PENDING) return { ok: false, message: "This access request has already been reviewed." };
  if (request.requesterId && request.requesterId === input.reviewer.id) return { ok: false, message: "You cannot review your own request." };
  if (request.requestedRole === RoleKey.ADMIN && input.reviewer.role !== RoleKey.SUPER_ADMIN) {
    return { ok: false, message: "Only a super admin can approve administrator access." };
  }

  const targetRole = request.requestedRole;
  const role = roles.find((candidate) => candidate.key === targetRole);
  if (!role) return { ok: false, message: "That role is not configured. Ask a super admin to seed the roles." };
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
          data: {
            roleId: role.id,
            isActive: true,
            accountStatus: AccountStatus.ACTIVE,
            approvedAt: new Date(),
            approvedById: input.reviewer.id,
            suspendedAt: null,
            suspensionReason: null,
            // A previous password must not reopen the account by itself. The
            // applicant redeems the emailed activation link, which also proves
            // they still control the address the administrator approved.
            mustSetPassword: true,
          },
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
        update: {
          staffType: input.staffType ?? request.staffType ?? StaffType.DECORATOR,
          status: StaffStatus.PENDING,
          isAvailable: true,
          adminId: null,
          inviteToken: null,
          inviteExpiresAt: null,
          activatedAt: null,
        },
        create: { userId: account.id, staffType: input.staffType ?? request.staffType ?? StaffType.DECORATOR, status: StaffStatus.PENDING, isAvailable: true },
      });
    }

    await tx.adminAccessRequest.update({ where: { id: input.requestId }, data: { userId: account.id } });
    return { id: account.id };
  });

  // Re-approval can follow a removal, and a customer can be promoted to staff.
  // Either way, a session that existed before this decision must not carry into
  // the new account. The activation flow creates a fresh session only after the
  // password and second factor are set.
  await revokeAllSessions(user.id, "Access re-approved; activation required.").catch((error) => {
    console.error("[team] session revocation failed after approval", error);
  });

  const roleLabel = targetRole === RoleKey.STAFF ? "staff" : "admin";
  const grantedStaffType = targetRole === RoleKey.STAFF ? input.staffType ?? request.staffType ?? null : null;
  const { absoluteUrl } = await import("@/lib/site");
  const activateUrl = absoluteUrl(`/activate?token=${encodeURIComponent(token)}`);

  // An override is recorded explicitly: the applicant asked for one thing and was
  // granted another, and the audit trail is the only place that is visible later.
  const staffDetail = grantedStaffType
    ? request.staffType && request.staffType !== grantedStaffType
      ? ` as ${grantedStaffType} (requested ${request.staffType})`
      : ` as ${grantedStaffType}`
    : "";
  // The audit entry and the applicant's notification are independent writes.
  // Running them together keeps the decision path to one round trip after the
  // transaction commits.
  await Promise.all([
    recordSecurityEvent({ type: "ACCESS_REQUEST_APPROVED", userId: user.id, email, ipAddress: input.ipAddress, detail: `Approved as ${roleLabel}${staffDetail} by reviewer ${input.reviewer.id}.` }),
    notifyUser(user.id, {
      type: NotificationType.STAFF_ACTIVATED,
      title: "Access approved",
      message: `An administrator approved your ${roleLabel} access. Use the link in your email to set a password and two-factor authentication.`,
      href: "/sign-in",
    }),
  ]);
  // SMTP is the slowest part of an approval. Schedule it after the response so
  // the reviewer sees the request clear immediately, while Vercel/Next keeps
  // the function alive long enough to deliver the invitation. If delivery
  // fails, the admins get an in-app alert rather than a silent stranded member.
  after(async () => {
    try {
      const mail = await sendTeamInviteEmail({
        to: email,
        firstName: firstName ?? "there",
        role: roleLabel,
        invitedBy: [input.reviewer.firstName, input.reviewer.lastName].filter(Boolean).join(" ") || "An administrator",
        activateUrl,
      });
      if (!mail.sent) {
        await notifyAdmins({
          type: NotificationType.STAFF_INVITE,
          title: "Invitation email could not be sent",
          message: `The activation email for ${email} failed. Open Staff and resend the invitation.`,
          href: "/admin/staff",
        });
      }
    } catch (error) {
      console.error("[team] invitation email failed after approval", error);
    }
  });

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
  // Same reason as approval: the decision is already stored, so do not make the
  // reviewer wait on an SMTP round trip.
  after(async () => {
    await sendAccessDeclinedEmail({ to: request.email, firstName: request.fullName.split(/\s+/)[0] ?? "there" }).catch((error) => {
      console.error("[team] decline email failed after review", error);
    });
  });
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

  /*
   * Redeeming the emailed link is the last step of the approval, so the account
   * becomes usable here.
   *
   * The link is only ever issued after an approval decision: an administrator
   * created the account directly, or a super admin approved the request. The
   * link itself proves the recipient controls the address, and it is
   * single-use and short-lived. Without this, an invited staff member set
   * their password and then could not sign in at all, because the account was
   * still awaiting approval and the sign-in refused it.
   *
   * A rejected or suspended account is not revived here: an activation link
   * cannot undo a decision an administrator made about the account.
   */
  const account = await prisma.user.findUnique({
    where: { id: inspected.userId },
    select: { id: true, email: true, accountStatus: true, role: { select: { key: true } } },
  });
  if (!account) return { ok: false, message: "That activation link is not valid." };
  if (account.accountStatus === AccountStatus.REJECTED) {
    return { ok: false, message: "This account was not accepted. Contact an administrator." };
  }
  if (account.accountStatus === AccountStatus.SUSPENDED) {
    return { ok: false, message: "This account is suspended. Contact an administrator." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: inspected.userId },
      data: {
        passwordHash: hashPassword(input.password),
        passwordChangedAt: new Date(),
        mustSetPassword: false,
        accountStatus: AccountStatus.ACTIVE,
        approvedAt: new Date(),
        // The activation link was delivered to this address, so redeeming it
        // proves the recipient controls the mailbox. Without this, a staff
        // member could set a password and then be refused at every later
        // sign-in as "email not verified".
        emailVerifiedAt: new Date(),
      },
    });
    // The staff profile follows the account: a member whose account is usable
    // but whose profile is still pending would land on the "waiting to be
    // activated" screen instead of their assignments.
    await tx.staff.updateMany({
      where: { userId: inspected.userId, status: StaffStatus.PENDING },
      data: { status: StaffStatus.ACTIVE, activatedAt: new Date() },
    });
  });
  // The activation link changes a credential and can promote a customer to
  // staff. Anything signed in before it is stale, including a customer session
  // that predates the role change. The caller starts the mandatory second-factor
  // step after this returns; that step creates the new session.
  await revokeAllSessions(inspected.userId, "Password set from an activation link.").catch((error) => {
    console.error("[team] session revocation failed after activation", error);
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
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, phone: true, accountStatus: true } });
  if (!user) return { ok: false, message: "Your account could not be loaded." };

  // Enrolling a second factor must not undo a decision an administrator made.
  // A suspended or rejected account stays that way: the enrolment is recorded,
  // but the account does not become usable again because the person proved they
  // can receive a code.
  if (user.accountStatus === AccountStatus.SUSPENDED) {
    return { ok: false, message: "This account is suspended. Contact an administrator." };
  }
  if (user.accountStatus === AccountStatus.REJECTED) {
    return { ok: false, message: "This account was not accepted. Contact an administrator." };
  }

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
