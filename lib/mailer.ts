import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { BookingStatus, StaffType } from "@prisma/client";
import { absoluteUrl, siteUrl } from "@/lib/site";
import { formatIstDate } from "@/lib/ist";
import { humanStaffType, isStaffInviteExpired, staffInviteExpiresAt, staffInviteUrl, STAFF_INVITE_TTL_DAYS } from "@/lib/staff-invite";

export { STAFF_INVITE_TTL_DAYS, isStaffInviteExpired, staffInviteExpiresAt, staffInviteUrl };

export type MailResult = { sent: boolean; reason?: string; error?: string };

/** How long a team activation link stays usable. */
export const TEAM_INVITE_TTL_DAYS = Number(process.env.TEAM_INVITE_TTL_DAYS ?? 3);

export function teamInviteExpiresAt(from = new Date()) {
  return new Date(from.getTime() + TEAM_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function envFlag(name: string) {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").toLowerCase());
}

/**
 * SMTP settings come from the environment. Until SMTP_HOST is provided the
 * mailer stays in "dry-run" mode: callers still succeed, but nothing is sent
 * and the reason is returned so the UI can explain it.
 */
export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

let cachedTransport: Transporter | null = null;
let cachedHost: string | null = null;

function getTransport(): Transporter | null {
  if (!isMailConfigured()) return null;
  if (cachedTransport && cachedHost === process.env.SMTP_HOST) return cachedTransport;
  const port = Number(process.env.SMTP_PORT ?? 587);
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: envFlag("SMTP_SECURE") || Number(process.env.SMTP_PORT) === 465,
    // A mail server that accepts the connection and then goes quiet must not
    // hold a booking response (or a sign-in code screen) open indefinitely.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  cachedHost = process.env.SMTP_HOST ?? null;
  return cachedTransport;
}

function businessName() {
  return process.env.MAIL_FROM_NAME || "Event Management";
}

function fromAddress() {
  return (process.env.SMTP_FROM || "no-reply@localhost").trim();
}

/**
 * `SMTP_FROM` may already be a full `"Name" <address>` header. Wrapping that
 * again produces a malformed From and the provider rejects the send, so only a
 * bare mailbox gets the business display name added here.
 */
function fromHeader() {
  const address = fromAddress();
  return /<[^>]+>/.test(address) ? address : `"${businessName()}" <${address}>`;
}

function shell(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const ctaBlock = cta
    ? `<tr><td style="padding:8px 32px 28px;"><a href="${cta.url}" style="display:inline-block;background:#d38a16;color:#1e1b16;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:999px;font-size:15px">${cta.label}</a></td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f7f1e8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e1b16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1e8;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid rgba(53,41,26,0.12);border-radius:24px;overflow:hidden">
        <tr><td style="padding:28px 32px 8px"><p style="margin:0;font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#8e5710">${businessName()}</p>
        <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25">${title}</h1></td></tr>
        <tr><td style="padding:16px 32px 8px;font-size:15px;line-height:1.6;color:#51483e">${bodyHtml}</td></tr>
        ${ctaBlock}
        <tr><td style="padding:20px 32px 30px;border-top:1px solid rgba(53,41,26,0.08)"><p style="margin:0;font-size:12px;line-height:1.6;color:#6f665b">Sent automatically by ${businessName()}. If you were not expecting this email you can safely ignore it.</p>
        <p style="margin:8px 0 0;font-size:12px;color:#6f665b"><a href="${siteUrl.origin}" style="color:#8e5710">${siteUrl.origin}</a></p></td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

async function sendMail(input: { to: string; subject: string; html: string; text: string }): Promise<MailResult> {
  const to = input.to.trim();
  // A missing or malformed address is the most common reason a customer never
  // receives a message. Catch it before Nodemailer, and leave a trace the admin
  // can act on instead of a silent no-op.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) {
    console.error(`[mailer] skipped "${input.subject}": no valid recipient address.`);
    return { sent: false, error: "No valid recipient email address." };
  }

  const transport = getTransport();
  if (!transport) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[mailer] SMTP not configured - skipped "${input.subject}" to ${to}`);
    }
    return { sent: false, reason: "SMTP is not configured yet." };
  }
  try {
    await transport.sendMail({ from: fromHeader(), ...input, to });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown mail error";
    console.error(`[mailer] send failed for "${input.subject}" to ${to}:`, message);
    return { sent: false, error: message };
  }
}

export async function sendStaffInviteEmail(input: {
  to: string;
  firstName: string;
  staffType: StaffType;
  token: string;
  invitedBy?: string;
}) {
  const url = staffInviteUrl(input.token);
  const type = humanStaffType(input.staffType);
  return sendMail({
    to: input.to,
    subject: `You've been invited to join ${businessName()} as ${type}`,
    html: shell(
      `Welcome, ${input.firstName}`,
      `<p>${input.invitedBy ? `${input.invitedBy} has` : "You have been"} invited you to join the <strong>${businessName()}</strong> team as a <strong>${type}</strong>.</p>
       <p>Activate your account to see your assigned events, locations, and timings.</p>
       <p style="color:#6f665b;font-size:13px">This invitation expires in ${STAFF_INVITE_TTL_DAYS} days. If you were not expecting it, ignore this email.</p>`,
      { label: "Activate my staff account", url },
    ),
    text: `You have been invited to join ${businessName()} as ${type}. Activate your account: ${url} (expires in ${STAFF_INVITE_TTL_DAYS} days).`,
  });
}

export async function sendStaffRequestReceivedEmail(input: {
  to: string;
  requesterName: string;
  requesterEmail: string;
  requestedRole: string;
}) {
  const url = absoluteUrl("/admin/admins");
  const role = input.requestedRole.toLowerCase();
  return sendMail({
    to: input.to,
    subject: `New ${role} access request from ${input.requesterName}`,
    html: shell(
      "New team access request",
      `<p><strong>${input.requesterName}</strong> (${input.requesterEmail}) has requested <strong>${role}</strong> access.</p>
       <p>Review the request and approve or decline it from the Admins page.</p>`,
      { label: "Review request", url },
    ),
    text: `${input.requesterName} (${input.requesterEmail}) requested ${role} access. Review it at ${url}`,
  });
}

export async function sendStaffRequestDeclinedEmail(input: { to: string; firstName: string; requestedRole: string }) {
  return sendMail({
    to: input.to,
    subject: `Update on your ${businessName()} access request`,
    html: shell(
      "Access request update",
      `<p>Hi ${input.firstName},</p><p>Your request for <strong>${input.requestedRole.toLowerCase()}</strong> access was not approved at this time.</p>
       <p>If you think this is a mistake, reply to your administrator.</p>`,
    ),
    text: `Hi ${input.firstName}, your request for ${input.requestedRole.toLowerCase()} access was not approved.`,
  });
}

export async function sendStaffActivatedEmail(input: { to: string; firstName: string; staffType: StaffType }) {
  return sendMail({
    to: input.to,
    subject: `Your ${businessName()} staff account is active`,
    html: shell(
      "Your account is active",
      `<p>Hi ${input.firstName},</p><p>Your staff account is now active. You can open your workspace to see assigned events.</p>`,
      { label: "Open staff workspace", url: absoluteUrl("/staff") },
    ),
    text: `Hi ${input.firstName}, your staff account is now active. Open ${absoluteUrl("/staff")}`,
  });
}

/** Sent when an administrator approves a sign-up that was waiting for review. */
export async function sendAccessApprovedEmail(input: { to: string; firstName: string }) {
  const url = absoluteUrl("/sign-in");
  return sendMail({
    to: input.to,
    subject: `Your ${businessName()} account has been approved`,
    html: shell(
      "Your request was approved",
      `<p>Hi ${input.firstName},</p><p>An administrator has approved your account, so you can now continue into the system.</p>
       <p>Sign in with <strong>${input.to}</strong> to reach your dashboard.</p>`,
      { label: "Sign in and continue", url },
    ),
    text: `Hi ${input.firstName}, an administrator approved your account. Sign in at ${url}`,
  });
}

/** Sent when an administrator rejects a sign-up. Deliberately unambiguous. */
export async function sendAccessDeclinedEmail(input: { to: string; firstName: string }) {
  return sendMail({
    to: input.to,
    subject: `Update on your ${businessName()} account request`,
    html: shell(
      "Your request was not accepted",
      `<p>Hi ${input.firstName},</p><p>Your request is <strong>not accepted by the admin</strong>, so you are not authorized to continue into this system. No booking, payment, or account data is available to you.</p>
       <p>If you believe this is a mistake, reply to your administrator.</p>`,
    ),
    text: `Hi ${input.firstName}, your request was not accepted by the admin, so you are not authorized to continue. Contact your administrator if this is a mistake.`,
  });
}

const OTP_COPY: Record<string, { title: string; lead: string }> = {
  TWO_FACTOR: { title: "Your sign-in code", lead: "Enter this code to finish signing in." },
  EMAIL_VERIFY: { title: "Confirm your email address", lead: "Enter this code to activate your account." },
  PHONE_VERIFY: { title: "Confirm your phone number", lead: "Enter this code to confirm this number belongs to you." },
  PASSWORD_RESET: { title: "Reset your password", lead: "Enter this code to choose a new password." },
  /**
   * The signed-in "change my password" flow reuses `OtpPurpose.PASSWORD_RESET`
   * because it is the same operation with the same bar, but the wording differs:
   * telling somebody who is deliberately changing their password to "reset" it
   * makes a legitimate action look like an attack.
   */
  PASSWORD_CHANGE: { title: "Confirm your new password", lead: "Enter this code to finish changing your password." },
};

/** Generic one-time-code email. The code is the only thing the user must read. */
export async function sendOtpEmail(input: { to: string; code: string; purpose: string; ttlMinutes: number }) {
  const copy = OTP_COPY[input.purpose] ?? { title: "Your verification code", lead: "Enter this code to continue." };
  return sendMail({
    to: input.to,
    subject: `${input.code} is your ${businessName()} verification code`,
    html: shell(
      copy.title,
      `<p>${copy.lead}</p>
       <p style="margin:18px 0 0;font-size:34px;font-weight:800;letter-spacing:.32em">${input.code}</p>
       <p style="color:#6f665b;font-size:13px">The code expires in ${input.ttlMinutes} minutes and can only be used once. If you did not request it, you can ignore this email.</p>`,
    ),
    text: `${copy.lead} Code: ${input.code} (expires in ${input.ttlMinutes} minutes, single use).`,
  });
}

/** Invitation for a team member created by a super admin or from a request. */
export async function sendTeamInviteEmail(input: { to: string; firstName: string; role: string; invitedBy: string; activateUrl: string }) {
  return sendMail({
    to: input.to,
    subject: `You have been added to ${businessName()} as ${input.role.toLowerCase()}`,
    html: shell(
      `Welcome, ${input.firstName}`,
      `<p>${input.invitedBy} has added you to the <strong>${businessName()}</strong> team as a <strong>${input.role.toLowerCase()}</strong>.</p>
       <p>Choose a password and set up two-factor authentication to finish activating your account. The link can be used once and expires in ${TEAM_INVITE_TTL_DAYS} days.</p>`,
      { label: "Activate my account", url: input.activateUrl },
    ),
    text: `${input.invitedBy} added you as ${input.role.toLowerCase()}. Activate your account: ${input.activateUrl} (expires in ${TEAM_INVITE_TTL_DAYS} days).`,
  });
}

/** The super admin's notification that somebody applied to join the team. */
export async function sendAccessRequestReceivedEmail(input: {
  to: string;
  requesterName: string;
  requesterEmail: string;
  requestedRole: string;
  /** What they asked to be, e.g. `driver`. Staff requests only. */
  requestedStaffType?: string | null;
}) {
  const url = absoluteUrl("/admin/admins");
  const asText = input.requestedStaffType ? `${input.requestedRole} — ${input.requestedStaffType}` : input.requestedRole;
  const asHtml = input.requestedStaffType
    ? `a <strong>${input.requestedRole.toLowerCase()}</strong> — specifically <strong>${input.requestedStaffType}</strong>`
    : `a <strong>${input.requestedRole.toLowerCase()}</strong>`;
  return sendMail({
    to: input.to,
    subject: `${input.requesterName} requested ${asText} access`,
    html: shell(
      "New access request",
      `<p><strong>${input.requesterName}</strong> (${input.requesterEmail}) asked to join the team as ${asHtml}.</p>
       <p>Review the request on the Admins page. Nothing is granted until you approve it.</p>`,
      { label: "Review request", url },
    ),
    text: `${input.requesterName} (${input.requesterEmail}) requested ${asText} access. Review it at ${url}`,
  });
}

/**
 * Values in these emails come from a Clerk profile, a booking form, or an
 * administrator's catalog entry, so they are escaped before they are placed in
 * HTML. A name is not a place to store markup.
 */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function eventDateLabel(value: Date) {
  // IST, like every other date the business shows. See `lib/ist.ts`.
  return formatIstDate(value);
}

function eventTypeLabel(value: string) {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstNameOf(value: string) {
  return escapeHtml(value.trim() || "there");
}

/** The first email a customer receives after signing in with Clerk for the first time. */
export async function sendCustomerWelcomeEmail(input: { to: string; firstName: string }) {
  const url = absoluteUrl("/customer/dashboard");
  const name = firstNameOf(input.firstName);
  return sendMail({
    to: input.to,
    subject: `Welcome to ${businessName()}`,
    html: shell(
      `Welcome, ${name}`,
      `<p>Your customer account is ready. From your dashboard you can send booking requests, follow their progress, review invoices, and pay securely.</p>
       <p>If you need a hand planning an event, reply to this email and our team will help.</p>`,
      { label: "Open my dashboard", url },
    ),
    text: `Welcome to ${businessName()}, ${input.firstName.trim() || "there"}. Your customer account is ready. Open your dashboard: ${url}`,
  });
}

/** The request details the customer keeps after submitting a booking. */
export async function sendBookingRequestEmail(input: {
  to: string;
  firstName: string;
  reference: string;
  eventType: string;
  eventDate: Date;
  location: string;
  guestCount: number;
  packageName?: string | null;
  services: Array<{ name: string; quantity: number }>;
  totalAmount: number;
  trackingUrl: string;
}) {
  const name = firstNameOf(input.firstName);
  const reference = escapeHtml(input.reference);
  const serviceLines = input.services.filter((service) => service.name.trim().length > 0);
  const serviceHtml =
    serviceLines.length > 0
      ? `<p style="margin:14px 0 4px"><strong>Services</strong></p><ul style="margin:0;padding-left:20px">${serviceLines
          .map((service) => `<li>${escapeHtml(service.name)}${service.quantity > 1 ? ` × ${service.quantity}` : ""}</li>`)
          .join("")}</ul>`
      : "";
  const packageHtml = input.packageName
    ? `<p><strong>Package:</strong> ${escapeHtml(input.packageName)}</p>`
    : "";
  return sendMail({
    to: input.to,
    subject: `We received your booking request (${reference})`,
    html: shell(
      "Your request is with our team",
      `<p>Hi ${name},</p>
       <p>Thank you for your booking request. We have received it and will review the details before confirming availability and the final quote.</p>
       <p><strong>Reference:</strong> ${reference}<br/>
          <strong>Event:</strong> ${escapeHtml(eventTypeLabel(input.eventType))} on ${escapeHtml(eventDateLabel(input.eventDate))}<br/>
          <strong>Location:</strong> ${escapeHtml(input.location)}<br/>
          <strong>Guests:</strong> ${input.guestCount}<br/>
          <strong>Estimated total:</strong> ${escapeHtml(money(input.totalAmount))}</p>
       ${packageHtml}${serviceHtml}
       <p style="margin-top:16px">You can follow the request from your dashboard. We will email you again when there is an update.</p>`,
      { label: "View my request", url: input.trackingUrl },
    ),
    text: `Hi ${input.firstName.trim() || "there"}, we received your booking request ${reference}. Event: ${eventTypeLabel(input.eventType)} on ${eventDateLabel(input.eventDate)}. Location: ${input.location}. Guests: ${input.guestCount}. Estimated total: ${money(input.totalAmount)}.${input.packageName ? ` Package: ${input.packageName}.` : ""}${serviceLines.length ? ` Services: ${serviceLines.map((service) => `${service.name}${service.quantity > 1 ? ` x ${service.quantity}` : ""}`).join(", ")}.` : ""} Follow it at ${input.trackingUrl}`,
  });
}

/** Sent when an administrator asks the customer to pay an advance or the balance. */
export async function sendPaymentRequestEmail(input: {
  to: string;
  firstName: string;
  reference: string;
  amount: number;
  modeLabel: string;
  balanceAmount: number;
  bookingUrl: string;
}) {
  const name = firstNameOf(input.firstName);
  const reference = escapeHtml(input.reference);
  const remaining = Math.max(0, input.balanceAmount - input.amount);
  return sendMail({
    to: input.to,
    subject: `Payment requested for booking ${reference}`,
    html: shell(
      "A payment is ready for you",
      `<p>Hi ${name},</p>
       <p>Our team has requested a <strong>${escapeHtml(input.modeLabel.toLowerCase())}</strong> payment of <strong>${escapeHtml(money(input.amount))}</strong> for booking <strong>${reference}</strong>.</p>
       <p><strong>Remaining balance after this payment:</strong> ${escapeHtml(money(remaining))}</p>
       <p>You can pay securely from your dashboard, where the request and invoice are also available.</p>`,
      { label: "View and pay", url: input.bookingUrl },
    ),
    text: `Hi ${input.firstName.trim() || "there"}, a ${input.modeLabel.toLowerCase()} payment of ${money(input.amount)} has been requested for booking ${reference}. Remaining balance after this payment: ${money(remaining)}. View and pay: ${input.bookingUrl}`,
  });
}

/** Sent when a manual, cash, or online payment has been recorded. */
export async function sendPaymentReceivedEmail(input: {
  to: string;
  firstName: string;
  reference: string;
  amount: number;
  balanceAmount: number;
  bookingUrl: string;
}) {
  const name = firstNameOf(input.firstName);
  const reference = escapeHtml(input.reference);
  const settled = input.balanceAmount <= 0.009;
  return sendMail({
    to: input.to,
    subject: `Payment received for booking ${reference}`,
    html: shell(
      "Payment received",
      `<p>Hi ${name},</p>
       <p>We have recorded your payment of <strong>${escapeHtml(money(input.amount))}</strong> for booking <strong>${reference}</strong>.</p>
       <p>${settled ? "Your booking is now fully paid." : `<strong>Remaining balance:</strong> ${escapeHtml(money(input.balanceAmount))}`}</p>
       <p>You can review the payment and invoice from your dashboard.</p>`,
      { label: "View my booking", url: input.bookingUrl },
    ),
    text: `Hi ${input.firstName.trim() || "there"}, we received your payment of ${money(input.amount)} for booking ${reference}. ${settled ? "Your booking is now fully paid." : `Remaining balance: ${money(input.balanceAmount)}.`} View it at ${input.bookingUrl}`,
  });
}

/**
 * Copy for every booking status. A status change is an update the customer
 * asked for, so approval and decline are not the only messages: preparation,
 * completion, and cancellation each get wording of their own. A cancellation
 * mentions money explicitly because a captured payment may need a refund.
 */
const BOOKING_STATUS_EMAIL: Record<BookingStatus, { subject: string; heading: string; body: string; text: string }> = {
  [BookingStatus.PENDING]: {
    subject: "Your booking is being reviewed",
    heading: "We have your request",
    body: "Your booking is back in review. We will confirm the details as soon as possible.",
    text: "your booking is back in review",
  },
  [BookingStatus.APPROVED]: {
    subject: "Your booking is approved",
    heading: "Your booking is approved",
    body: "We have reserved the services and will contact you about the next steps.",
    text: "your booking is approved",
  },
  [BookingStatus.PREPARING]: {
    subject: "We are preparing for your event",
    heading: "Your event is being prepared",
    body: "Our team has started preparing for your event. We will keep you updated as the date approaches.",
    text: "we have started preparing for your event",
  },
  [BookingStatus.COMPLETED]: {
    subject: "Your event is complete",
    heading: "Thank you for choosing us",
    body: "Your event has been marked complete. Thank you for trusting us with it. You can review the final invoice from your dashboard.",
    text: "your event is complete",
  },
  [BookingStatus.CANCELLED]: {
    subject: "Your booking has been cancelled",
    heading: "Your booking was cancelled",
    body: "This booking has been cancelled. If a payment was captured, our team will contact you about the refund and any remaining balance.",
    text: "your booking has been cancelled",
  },
  [BookingStatus.REJECTED]: {
    subject: "Update on your booking request",
    heading: "Your booking request was not accepted",
    body: "Unfortunately we cannot accept this booking at this time. If you would like to discuss alternatives, reply to this email.",
    text: "we cannot accept your booking request",
  },
};

/** Sent on every booking status change. */
export async function sendBookingStatusEmail(input: {
  to: string;
  firstName: string;
  reference: string;
  status: BookingStatus;
  eventDate: Date;
  location: string;
  bookingUrl: string;
}) {
  const name = firstNameOf(input.firstName);
  const reference = escapeHtml(input.reference);
  const copy = BOOKING_STATUS_EMAIL[input.status];
  const event = `${escapeHtml(eventDateLabel(input.eventDate))} at ${escapeHtml(input.location)}`;
  return sendMail({
    to: input.to,
    subject: `${copy.subject} (${reference})`,
    html: shell(
      copy.heading,
      `<p>Hi ${name},</p>
       <p>${copy.body} Your booking is for <strong>${event}</strong>.</p>
       <p>You can see the request and any updates from your dashboard.</p>`,
      { label: "View my booking", url: input.bookingUrl },
    ),
    text: `Hi ${input.firstName.trim() || "there"}, ${copy.text} for ${eventDateLabel(input.eventDate)} at ${input.location} (${reference}). View it at ${input.bookingUrl}`,
  });
}
