/**
 * Client-side validation for the credential screens.
 *
 * Two jobs:
 *
 *  1. An empty or malformed field produces an immediate, readable message that
 *     names the field, instead of a round trip that ends in a generic banner.
 *  2. The toast can say exactly which required field is missing, which is the
 *     whole point of requirement "tell the user what is missing".
 *
 * These rules are deliberately NOT the security boundary. Anything checked only
 * in the browser can be skipped by posting to the server action directly, so
 * `lib/auth-actions.ts` re-applies every one of them with Zod before it writes
 * anything. Keeping this module free of `"use client"` lets the tests import it
 * with `node:test` and lets both sides share one set of messages.
 */

export type CredentialFieldIssue = { field: string; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

/** First string value for every key, so a repeated field name cannot shadow one. */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && values[key] === undefined) values[key] = value;
  }
  return values;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Digits only.
 *
 * People paste codes with the spaces or dashes the subject line uses, so those
 * are stripped as well as any stray character: the box should never hold
 * something the server is guaranteed to reject.
 */
export function normaliseCode(value: string): string {
  return value.replace(/\D/g, "");
}

/** Collapses the issues into the shape `AuthActionState.fieldErrors` expects. */
export function toFieldErrors(issues: CredentialFieldIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (!errors[issue.field]) errors[issue.field] = issue.message;
  }
  return errors;
}

function required(field: string, label: string, value: string | undefined, issues: CredentialFieldIssue[]) {
  if (!value || value.trim().length === 0) issues.push({ field, message: `${label} is required.` });
}

function checkEmail(field: string, label: string, raw: string | undefined, issues: CredentialFieldIssue[]) {
  required(field, label, raw, issues);
  const email = normaliseEmail(raw ?? "");
  if (email && !EMAIL_PATTERN.test(email)) issues.push({ field, message: "Enter a valid email address." });
}

function checkCode(raw: string | undefined, issues: CredentialFieldIssue[]) {
  if (!raw) return;
  const code = normaliseCode(raw);
  if (!/^\d{6}$/.test(code)) issues.push({ field: "code", message: `Enter the ${CODE_LENGTH}-digit code.` });
}

function checkPair(next: string | undefined, confirm: string | undefined, issues: CredentialFieldIssue[]) {
  required("newPassword", "A new password", next, issues);
  required("confirmPassword", "The password confirmation", confirm, issues);
  if (next && confirm && next !== confirm) issues.push({ field: "confirmPassword", message: "Passwords do not match." });
}

/**
 * Email address card. The code field only exists once the server has confirmed
 * the current password and posted the code, so it is validated only when filled.
 */
export function validateEmailChangeForm(values: Record<string, string>): CredentialFieldIssue[] {
  const issues: CredentialFieldIssue[] = [];
  checkEmail("newEmail", "A new email address", values.newEmail, issues);
  required("currentPassword", "Your current password", values.currentPassword, issues);
  checkCode(values.code, issues);
  return issues;
}

/** Password card: current password, new password, confirmation, then the code. */
export function validatePasswordChangeForm(values: Record<string, string>): CredentialFieldIssue[] {
  const issues: CredentialFieldIssue[] = [];
  required("currentPassword", "Your current password", values.currentPassword, issues);
  checkPair(values.newPassword, values.confirmPassword, issues);
  checkCode(values.code, issues);
  return issues;
}

/** Step 1 of "forgot password": just an address. */
export function validateResetRequestForm(values: Record<string, string>): CredentialFieldIssue[] {
  const issues: CredentialFieldIssue[] = [];
  checkEmail("email", "Your email address", values.email, issues);
  return issues;
}

/** Step 2 of "forgot password": the same address plus the code sent to it. */
export function validateResetCodeForm(values: Record<string, string>): CredentialFieldIssue[] {
  const issues: CredentialFieldIssue[] = [];
  checkEmail("email", "Your email address", values.email, issues);
  required("code", "The 6-digit code", values.code, issues);
  checkCode(values.code, issues);
  return issues;
}

/** The last step of a reset: the new password and its confirmation. */
export function validateNewPasswordForm(values: Record<string, string>): CredentialFieldIssue[] {
  const issues: CredentialFieldIssue[] = [];
  checkPair(values.newPassword, values.confirmPassword, issues);
  return issues;
}