import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Session lifetime contract.
 *
 * The complaint was concrete: sign in, shut the machine down, come back, and the
 * site asked for credentials again. The cookie was issued for twelve hours, so an
 * overnight gap was enough to lose it. Thirty days is now the floor for a normal
 * "remember me" expectation; the cap exists so a typo in the environment cannot
 * issue a decade-long credential.
 *
 * Kept as a source contract with the rest of the session tests: importing
 * `lib/auth/session.ts` pulls `next/headers`, which is only meaningful inside a
 * request.
 */

const source = readFileSync("lib/auth/session.ts", "utf8");

test("the default session lasts thirty days", () => {
  assert.match(
    source,
    /process\.env\.SESSION_MAX_AGE_HOURS \?\? 24 \* 30/,
    "the default must be 30 days, not the old 12 hours",
  );
  assert.match(
    source,
    /Math\.min\(Math\.max\(Number\.isFinite\(hours\) \? hours : 24 \* 30, 1\), 24 \* 30\) \* 3600/,
    "the value must be clamped to a sane range, with 30 days as the ceiling",
  );
});

test("both the session and the device cookie use that lifetime", () => {
  const setCookies = source.slice(source.indexOf("export async function setSessionCookies"));
  assert.match(setCookies, /const maxAge = sessionMaxAgeSeconds\(\)/);
  const sessionCookie = setCookies.slice(setCookies.indexOf("store.set(sessionCookieName"), setCookies.indexOf("store.set(DEVICE_COOKIE"));
  assert.match(sessionCookie, /maxAge/);
  const deviceCookie = setCookies.slice(setCookies.indexOf("store.set(DEVICE_COOKIE"));
  assert.match(deviceCookie, /maxAge/);
});

test("nothing else silently expires the row", () => {
  // The database row deliberately has no expiry column: a session stays valid
  // until the cookie disappears or the account is revoked, and every request
  // re-checks the live user. An `expiresAt` filter here would quietly reintroduce
  // the short lifetime regardless of the cookie.
  assert.doesNotMatch(source, /expiresAt/);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const authSession = schema.slice(schema.indexOf("model AuthSession"), schema.indexOf("model OtpChallenge"));
  assert.doesNotMatch(authSession, /expiresAt/);
});

test("the cookie is persistent rather than a browser-session cookie", () => {
  // `maxAge` is what makes it survive a reboot; `expires` would work too, but a
  // missing one would make it a session cookie that dies with the browser.
  assert.match(source, /maxAge/);
  assert.match(source, /sameSite: "lax"/);
  assert.match(source, /httpOnly: true/);
});

test("logging out still clears the long-lived cookie", () => {
  assert.match(source, /export async function clearSessionCookies/);
  const clear = source.slice(source.indexOf("export async function clearSessionCookies"));
  assert.match(clear, /store\.delete\(sessionCookieName/);
  assert.match(clear, /store\.delete\(DEVICE_COOKIE\)/);
});
