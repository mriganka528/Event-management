import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing and strength policy.
 *
 * Hashing uses `scrypt` from the Node standard library with a per-password
 * random salt. The stored format is self-describing:
 *
 *   scrypt$N$r$p$<salt-hex>$<hash-hex>
 *
 * so the cost parameters can be raised later without invalidating existing
 * hashes: verification reads them back out of the stored string.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// scrypt needs maxmem >= 128 * N * r, which exceeds the default 32 MB at N=16384.
const MAX_MEM = 64 * 1024 * 1024;

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

/**
 * Length and composition, checked without any network access.
 *
 * A short blocklist is also applied, but deliberately only in its *literal*
 * form. Every clever normalisation (`Password123!`, `P@ssw0rd`, `Passw0rd234`)
 * is covered properly by {@link assertPasswordNotBreached} instead, which
 * consults a real breach corpus. Guessing rewrites here would give the
 * appearance of a check while letting variants through.
 */
const SHORT_PASSWORD_BLOCKLIST = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "iloveyou",
  "administrator",
  "welcome1",
  "letmein",
  "trustno1",
  "football",
  "baseball",
  "princess",
  "sunshine",
]);

export function checkPasswordPolicy(password: string, context: { email?: string; name?: string } = {}): PasswordPolicyResult {
  if (password.length < 12) return { ok: false, message: "Use at least 12 characters." };
  if (password.length > 200) return { ok: false, message: "Password is too long." };
  if (!/[a-z]/.test(password)) return { ok: false, message: "Add a lowercase letter." };
  if (!/[A-Z]/.test(password)) return { ok: false, message: "Add an uppercase letter." };
  if (!/[0-9]/.test(password)) return { ok: false, message: "Add a number." };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, message: "Add a symbol." };
  if (/\s/.test(password)) return { ok: false, message: "Remove the spaces." };

  if (SHORT_PASSWORD_BLOCKLIST.has(password.toLowerCase())) {
    return { ok: false, message: "That password is too common. Choose something unique." };
  }
  if (/(.)\1{3,}/.test(password)) return { ok: false, message: "Avoid repeated characters." };

  // Reject anything that embeds the account's own identity.
  const lowered = password.toLowerCase();
  const localPart = (context.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const hints = [localPart, ...(context.name ?? "").split(/\s+/)].filter((part) => part && part.length >= 4);
  if (hints.some((hint) => lowered.includes(hint))) {
    return { ok: false, message: "Do not use your name or email in the password." };
  }

  // Reject simple sequences and keyboard runs.
  if (/^(0123|1234|2345|3456|4567|5678|6789|abcd|qwerty|asdf|zxcv)/.test(lowered)) {
    return { ok: false, message: "Avoid predictable patterns." };
  }

  return { ok: true };
}

// --------------------------------------------------------------- breach check

/**
 * Breach lookup against the Have I Been Pwned range API.
 *
 * Only the first five characters of the SHA-1 digest ever leave the server, and
 * the matching suffixes are compared locally, so neither the password nor its
 * full hash is disclosed.
 *
 * Failure mode matters here: if the service is unreachable the password is
 * still *allowed*, because refusing every sign-in during an outage would be
 * worse than the marginal risk. The composition rules above are what always
 * apply; this is an additional check, not the only one.
 */
const BREACH_API = "https://api.pwnedpasswords.com/range";

export async function isPasswordBreached(password: string): Promise<boolean> {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  try {
    const response = await fetch(`${BREACH_API}/${prefix}`, {
      headers: { "add-padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const body = await response.text();
    for (const line of body.split("\n")) {
      // Each line is `SUFFIX:COUNT`; padding rows have a count of 0.
      const separator = line.indexOf(":");
      if (separator === -1) continue;
      if (line.slice(0, separator).trim() === suffix) return true;
    }
    return false;
  } catch {
    // Offline or rate-limited: fail open rather than locking everyone out.
    return false;
  }
}

/**
 * The full check used wherever a password is chosen: local rules first (so a
 * user is never told to change a password merely because a network call
 * failed), then the breach corpus.
 */
export async function assertPasswordAcceptable(
  password: string,
  context: { email?: string; name?: string } = {},
): Promise<PasswordPolicyResult> {
  const policy = checkPasswordPolicy(password, context);
  if (!policy.ok) return policy;

  if (await isPasswordBreached(password)) {
    return { ok: false, message: "That password has appeared in a data breach. Choose something nobody else has used." };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ hashing

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEM });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), derived.toString("hex")].join("$");
}

/** Constant-time verification. Returns false for any malformed stored value. */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem: MAX_MEM });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** SHA-256 hex, used for session tokens and OTP codes (low-entropy, already salted by expiry). */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A high-entropy opaque token. Only its hash is ever persisted. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
