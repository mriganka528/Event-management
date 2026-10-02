import "server-only";

import { randomInt } from "node:crypto";
import { OtpChannel, OtpPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/auth/password";
import { isPhoneOtpEnabled, normalisePhone, sendSms } from "@/lib/auth/sms";
import { isMailConfigured } from "@/lib/mailer";

/**
 * One-time codes for the second factor, address verification, and password
 * resets.
 *
 * Security properties:
 *  - only a SHA-256 hash of the code is stored, never the code itself;
 *  - every challenge is single-use (`consumedAt`) and short-lived;
 *  - attempts are counted per challenge and the challenge is burned at
 *    `maxAttempts`, so a 6-digit space cannot be brute-forced;
 *  - issuance is throttled per destination, so codes cannot be spammed to
 *    trigger SMS/email flooding;
 *  - a challenge may be bound to the half-finished sign-in that requested it, so
 *    a code cannot be replayed from a different browser.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_LENGTH = 6;
const RESEND_COOLDOWN_MS = 60 * 1000;
/** At most one unconsumed challenge per destination/purpose inside a window. */
const MAX_ISSUES_PER_WINDOW = 5;
const ISSUE_WINDOW_MS = 60 * 60 * 1000;

export class OtpError extends Error {
  readonly code: "INVALID_CODE" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "NOT_FOUND" | "ALREADY_USED" | "RATE_LIMITED" | "CHANNEL_UNAVAILABLE";
  constructor(code: OtpError["code"], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

function generateNumericCode(): string {
  // Rejection sampling keeps every code uniformly distributed (no modulo bias),
  // which matters because the search space is only 10^6.
  const upper = 10 ** OTP_LENGTH;
  const limit = Math.floor(0x100000000 / upper) * upper;
  let value: number;
  do {
    value = randomInt(0, limit);
  } while (value >= limit);
  return (value % upper).toString().padStart(OTP_LENGTH, "0");
}

function normaliseDestination(channel: OtpChannel, raw: string): string | null {
  if (channel === OtpChannel.EMAIL) {
    const email = raw.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
  }
  return normalisePhone(raw);
}

async function deliverEmailOtp(input: { to: string; code: string; purpose: OtpPurpose; ttlMinutes: number }) {
  if (!isMailConfigured()) {
    // Dry-run: the code is logged so local development stays usable without SMTP.
    console.info(`[otp] email ${input.purpose} for ${input.to}: ${input.code}`);
    return { sent: true as const, detail: "logged" };
  }
  const { sendOtpEmail } = await import("@/lib/mailer");
  const result = await sendOtpEmail({ to: input.to, code: input.code, purpose: input.purpose, ttlMinutes: input.ttlMinutes });
  return { sent: result.sent, detail: result.reason };
}

export type IssueOtpInput = {
  userId?: string | null;
  email: string;
  phone?: string | null;
  channel: OtpChannel;
  purpose: OtpPurpose;
  boundSessionId?: string | null;
  ipAddress?: string | null;
};

export type IssueOtpResult =
  | { ok: true; channel: OtpChannel; destination: string; expiresAt: Date; resendAvailableAt: Date; deliveredBy: string }
  | { ok: false; code: OtpError["code"]; message: string };

/** Issues and delivers a fresh code, or reports why it could not. */
export async function issueOtp(input: IssueOtpInput): Promise<IssueOtpResult> {
  const destination = normaliseDestination(input.channel, input.channel === OtpChannel.EMAIL ? input.email : (input.phone ?? ""));
  if (!destination) {
    return { ok: false, code: "CHANNEL_UNAVAILABLE", message: input.channel === OtpChannel.EMAIL ? "Enter a valid email address." : "Enter a valid phone number." };
  }
  if (input.channel === OtpChannel.PHONE && !isPhoneOtpEnabled()) {
    return { ok: false, code: "CHANNEL_UNAVAILABLE", message: "Phone codes are not available. Use email instead." };
  }

  const windowStart = new Date(Date.now() - ISSUE_WINDOW_MS);
  const recent = await prisma.otpChallenge.count({
    where: { destination, purpose: input.purpose, createdAt: { gte: windowStart } },
  });
  if (recent >= MAX_ISSUES_PER_WINDOW) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many codes requested. Try again later." };
  }

  // Invalidate any outstanding challenge so only the newest code works.
  await prisma.otpChallenge.updateMany({
    where: { destination, purpose: input.purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateNumericCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const resendAvailableAt = new Date(Date.now() + RESEND_COOLDOWN_MS);

  await prisma.otpChallenge.create({
    data: {
      userId: input.userId ?? null,
      purpose: input.purpose,
      channel: input.channel,
      destination,
      codeHash: sha256(code),
      expiresAt,
      boundSessionId: input.boundSessionId ?? null,
    },
  });

  const ttlMinutes = Math.round(OTP_TTL_MS / 60_000);
  let deliveredBy: string;
  if (input.channel === OtpChannel.EMAIL) {
    const mail = await deliverEmailOtp({ to: destination, code, purpose: input.purpose, ttlMinutes });
    if (!mail.sent) {
      return { ok: false, code: "CHANNEL_UNAVAILABLE", message: "The code could not be sent. Try again shortly." };
    }
    deliveredBy = "email";
  } else {
    const sms = await sendSms(destination, `${code} is your ${input.purpose.toLowerCase().replaceAll("_", " ")} code. It expires in ${ttlMinutes} minutes.`);
    if (!sms.sent) {
      return { ok: false, code: "CHANNEL_UNAVAILABLE", message: "The code could not be sent. Try again shortly." };
    }
    deliveredBy = sms.provider;
  }

  return { ok: true, channel: input.channel, destination, expiresAt, resendAvailableAt, deliveredBy };
}

/**
 * Verifies a submitted code. On success the challenge is consumed so the same
 * code cannot be replayed.
 */
export async function verifyOtp(input: {
  userId?: string | null;
  destination: string;
  purpose: OtpPurpose;
  code: string;
  boundSessionId?: string | null;
}): Promise<{ ok: true; challengeId: string }> {
  const code = input.code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) throw new OtpError("INVALID_CODE", "Enter the 6-digit code.");

  const destination = input.destination.trim().toLowerCase();
  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      destination,
      purpose: input.purpose,
      consumedAt: null,
      ...(input.userId ? { userId: input.userId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw new OtpError("NOT_FOUND", "Request a new code.");
  if (challenge.consumedAt) throw new OtpError("ALREADY_USED", "That code has already been used.");
  if (challenge.expiresAt.getTime() < Date.now()) throw new OtpError("EXPIRED", "That code has expired. Request a new one.");
  if (challenge.boundSessionId && input.boundSessionId && challenge.boundSessionId !== input.boundSessionId) {
    // The code was issued to a different half-finished sign-in attempt.
    throw new OtpError("NOT_FOUND", "Request a new code.");
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    throw new OtpError("TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
  }

  if (sha256(code) !== challenge.codeHash) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });
    if (updated.attempts >= updated.maxAttempts) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      throw new OtpError("TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
    }
    const left = updated.maxAttempts - updated.attempts;
    throw new OtpError("INVALID_CODE", `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.`);
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  return { ok: true, challengeId: challenge.id };
}

/** Seconds the caller must wait before asking for another code. */
export async function resendCooldownSeconds(destination: string, purpose: OtpPurpose): Promise<number> {
  const latest = await prisma.otpChallenge.findFirst({
    where: { destination: destination.toLowerCase(), purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!latest) return 0;
  const wait = RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime());
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/** Removes expired codes and consumed attempts. Called opportunistically. */
export async function purgeExpiredOtp() {
  await prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => undefined);
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }).catch(() => undefined);
}

export async function hasActiveTwoFactor(userId: string): Promise<boolean> {
  return (await prisma.otpChallenge.count({ where: { userId, purpose: OtpPurpose.TWO_FACTOR, consumedAt: null, expiresAt: { gt: new Date() } } })) > 0;
}

export const OTP_CONSTANTS = { TTL_MS: OTP_TTL_MS, LENGTH: OTP_LENGTH, RESEND_COOLDOWN_MS } as const;
