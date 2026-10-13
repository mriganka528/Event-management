import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Content-Security-Policy contract for the hosted identity provider.
 *
 * Clerk's `<SignIn/>` and `<SignUp/>` render their CAPTCHA in a sandboxed iframe
 * served by Cloudflare Turnstile. Turnstile is a *separate origin* from Clerk,
 * and every one of its three delivery channels has to be allowed independently:
 *
 *   - `script-src`   the challenge widget's own JavaScript
 *   - `connect-src`  the calls it makes back to Cloudflare
 *   - `frame-src`    the iframe Turnstile itself is rendered into
 *
 * With any of them missing, Clerk still paints its form, the widget never
 * initialises, and the component reports "The CAPTCHA failed to load. This may
 * be due to an unsupported browser or a browser extension." — a message that
 * sends you looking at the visitor's browser extensions when the real cause is
 * this policy.
 */

const config = readFileSync("next.config.ts", "utf8");
const configLines = config.split("\n");

/**
 * Returns the source line(s) that declare one CSP directive.
 *
 * Line-based rather than a single regex because the values are quoted strings
 * containing apostrophes (`'self'`), and any character-class-based extraction
 * stops at the first one and silently yields a truncated directive.
 */
function directive(name: string): string {
  const lines = configLines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(`"${name} `) || trimmed.startsWith("`" + name + " ");
  });
  assert.ok(lines.length > 0, `the CSP has no ${name} directive`);
  return lines.join("\n");
}

const TURNSTILE = "https://challenges.cloudflare.com";

test("the CAPTCHA origin is allowed in every directive it needs", () => {
  // Each is required: a partial fix still fails, just later and less obviously.
  // The directives reference the shared constant, so that counts as allowing the
  // origin — inlining the literal in each one is what the next test forbids.
  for (const name of ["script-src", "connect-src", "frame-src", "img-src"]) {
    const value = directive(name);
    const allowsTurnstile =
      value.includes("TURNSTILE_ORIGIN") || value.includes(TURNSTILE);
    assert.ok(
      allowsTurnstile,
      `${name} must allow ${TURNSTILE} (directly or via TURNSTILE_ORIGIN), or Clerk's CAPTCHA cannot load. Got: ${value}`,
    );
  }
});

test("the origin is declared once as a named constant", () => {
  // A literal repeated across four directives is how they drift apart — the
  // symptom is a CAPTCHA that works on one page and not another.
  assert.match(
    config,
    /const TURNSTILE_ORIGIN\s*=\s*"https:\/\/challenges\.cloudflare\.com"/,
    "the Turnstile origin must be declared once as TURNSTILE_ORIGIN",
  );
  const literalCount = (config.match(/https:\/\/challenges\.cloudflare\.com/g) ?? []).length;
  assert.equal(literalCount, 1, `the Turnstile origin is written out ${literalCount} times; it must be a single constant`);
});

test("the CAPTCHA fix did not weaken the policy by adding a wildcard", () => {
  // The point of naming one origin is that the exception stays narrow. Subdomain
  // wildcards for Clerk are already there and are fine; what must not appear is
  // an allow-everything host such as `https://*`.
  for (const name of ["script-src", "connect-src", "frame-src"]) {
    const value = directive(name);
    assert.doesNotMatch(
      value,
      /https:\/\/\*(?![\w.])/,
      `${name} must not grant an allow-any-host wildcard to fix the CAPTCHA; name the single host instead`,
    );
    assert.doesNotMatch(
      value,
      /(?:^|\s)\*(?:\s|$|;)/,
      `${name} must not grant a bare wildcard source to fix the CAPTCHA`,
    );
  }
});

test("Clerk itself stays allowed", () => {
  // Guard against the CAPTCHA fix accidentally replacing the Clerk origins.
  for (const name of ["script-src", "connect-src", "frame-src"]) {
    const value = directive(name);
    assert.match(value, /https:\/\/\*\.clerk\.com/, `${name} must still allow Clerk`);
    assert.match(value, /https:\/\/\*\.clerk\.accounts\.dev/, `${name} must still allow Clerk's asset host`);
  }
});

test("the policy still forbids framing and third-party objects", () => {
  assert.match(directive("frame-ancestors"), /'none'/, "this app must never be framed");
  assert.match(directive("object-src"), /'none'/, "plugins must stay blocked");
});