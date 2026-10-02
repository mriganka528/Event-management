import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { AccountStatus, RoleKey } from "@prisma/client";

/**
 * `import "server-only"` is a bundler assertion that throws when a module is
 * loaded outside a React Server graph, which is exactly what the test runner is.
 * `password.ts` and `sms.ts` are therefore loaded through this `require`, whose
 * `react-server` condition makes the assertion resolve to a no-op.
 */
const require = createRequire(import.meta.url);

/** Recursively lists the source files under a path, for source-level assertions. */
function walk(target: string): string[] {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).flatMap((entry) => walk(join(target, entry)));
}
import {
  ALLOWED_RETURN_PATHS,
  canGrantRole,
  canModifyAccount,
  canReviewRoleRequest,
  deriveAccessState,
  gatePathForState,
  isAccountUsable,
  isAdminRole,
  isSuperAdminRole,
  landingPathForState,
  requiresMfa,
  safeReturnTo,
  workspaceForRole,
} from "@/lib/access-policy";
// `password` and `sms` are server-only; loaded through the shim above.
const { checkPasswordPolicy, generateToken, hashPassword, sha256, verifyPassword } =
  require("@/lib/auth/password") as typeof import("@/lib/auth/password");

/**
 * Executable specification for the first-party auth rules. The properties that
 * matter most:
 *   1. a correct password alone never grants a privileged session,
 *   2. an email is never auto-merged into another identity,
 *   3. nothing about a password or a one-time code is recoverable from storage.
 */

test("an unauthenticated visitor is never granted any role", () => {
  assert.equal(deriveAccessState({ authenticated: false, isActive: true, accountStatus: AccountStatus.ACTIVE, role: RoleKey.SUPER_ADMIN, mfaBlocked: false }), "UNAUTHENTICATED");
  assert.equal(landingPathForState("UNAUTHENTICATED", null), "/sign-in");
});

test("a new account is pending approval even if it holds an admin role", () => {
  const state = deriveAccessState({ authenticated: true, isActive: true, accountStatus: AccountStatus.PENDING_APPROVAL, role: RoleKey.ADMIN, mfaBlocked: false });
  assert.equal(state, "PENDING_APPROVAL");
  assert.equal(landingPathForState(state, { role: RoleKey.ADMIN }), "/access-pending");
});

test("only isActive + ACTIVE is usable, regardless of role", () => {
  assert.equal(isAccountUsable(AccountStatus.ACTIVE, true), true);
  assert.equal(isAccountUsable(AccountStatus.PENDING_APPROVAL, true), false);
  assert.equal(isAccountUsable(AccountStatus.ACTIVE, false), false);
  assert.equal(isAccountUsable(AccountStatus.SUSPENDED, true), false);
  assert.equal(isAccountUsable(AccountStatus.REJECTED, true), false);
});

test("rejection and suspension win over the deactivated flag", () => {
  // Both also clear `isActive`, so the status has to be read first or the user
  // is told the wrong thing.
  assert.equal(deriveAccessState({ authenticated: true, isActive: false, accountStatus: AccountStatus.REJECTED, role: RoleKey.CUSTOMER, mfaBlocked: false }), "REJECTED");
  assert.equal(deriveAccessState({ authenticated: true, isActive: false, accountStatus: AccountStatus.SUSPENDED, role: RoleKey.ADMIN, mfaBlocked: false }), "SUSPENDED");
  assert.equal(gatePathForState("REJECTED"), "/access-denied");
  assert.equal(gatePathForState("SUSPENDED"), "/access-denied");
});

test("the live guard delegates to the tested policy instead of re-deciding", () => {
  // `toState` used to re-implement this ordering and checked `isActive` first,
  // which told a rejected user they were merely "deactivated". Assert the
  // server-side mapper routes through the pure function so the tests above
  // actually cover the behaviour the user experiences.
  const source = readFileSync("lib/auth/server.ts", "utf8");
  assert.ok(source.includes("deriveAccessState({"), "the guard must call deriveAccessState");
  // The status checks must not be re-implemented inline in the mapper.
  const mapper = source.slice(source.indexOf("function toState("), source.indexOf("export const getAuthContext"));
  assert.doesNotMatch(mapper, /isActive\)\s*return/, "toState must not branch on isActive before accountStatus");
  assert.doesNotMatch(mapper, /AccountStatus\.(REJECTED|SUSPENDED)/, "toState must not re-implement the status ordering");
});

test("a deactivated account is denied ahead of any role", () => {
  assert.equal(deriveAccessState({ authenticated: true, isActive: false, accountStatus: AccountStatus.ACTIVE, role: RoleKey.SUPER_ADMIN, mfaBlocked: false }), "DEACTIVATED");
  assert.equal(gatePathForState("DEACTIVATED"), "/access-denied");
});

test("an approved account lands in the workspace for its role", () => {
  assert.equal(landingPathForState("ACTIVE", { role: RoleKey.SUPER_ADMIN }), "/admin");
  assert.equal(landingPathForState("ACTIVE", { role: RoleKey.ADMIN }), "/admin");
  assert.equal(landingPathForState("ACTIVE", { role: RoleKey.STAFF }), "/staff");
  assert.equal(landingPathForState("ACTIVE", { role: RoleKey.CUSTOMER }), "/customer/dashboard");
  assert.equal(workspaceForRole(RoleKey.ADMIN), "/admin");
});

test("two-factor is mandatory for admins and optional for everyone else", () => {
  assert.equal(requiresMfa(RoleKey.SUPER_ADMIN), true);
  assert.equal(requiresMfa(RoleKey.ADMIN), true);
  assert.equal(requiresMfa(RoleKey.STAFF), false);
  assert.equal(requiresMfa(RoleKey.CUSTOMER), false);
});

test("an admin without two-factor is held at the MFA gate", () => {
  const state = deriveAccessState({ authenticated: true, isActive: true, accountStatus: AccountStatus.ACTIVE, role: RoleKey.ADMIN, mfaBlocked: true });
  assert.equal(state, "MFA_REQUIRED");
  assert.equal(gatePathForState("MFA_REQUIRED"), "/two-factor-required");
  // The same account is fine once the second factor exists.
  assert.equal(deriveAccessState({ authenticated: true, isActive: true, accountStatus: AccountStatus.ACTIVE, role: RoleKey.ADMIN, mfaBlocked: false }), "ACTIVE");
});

test("role helpers agree on what counts as an administrator", () => {
  assert.equal(isAdminRole(RoleKey.SUPER_ADMIN), true);
  assert.equal(isAdminRole(RoleKey.ADMIN), true);
  assert.equal(isAdminRole(RoleKey.STAFF), false);
  assert.equal(isAdminRole(RoleKey.CUSTOMER), false);
  assert.equal(isAdminRole(null), false);
  assert.equal(isSuperAdminRole(RoleKey.SUPER_ADMIN), true);
  assert.equal(isSuperAdminRole(RoleKey.ADMIN), false);
});

test("nobody can change their own access", () => {
  assert.match(canModifyAccount({ id: "u1", role: RoleKey.SUPER_ADMIN }, { id: "u1", role: RoleKey.SUPER_ADMIN }) ?? "", /your own access/i);
});

test("only a super admin may modify or grant super admin", () => {
  const admin = { id: "a1", role: RoleKey.ADMIN };
  const superAdmin = { id: "s1", role: RoleKey.SUPER_ADMIN };
  assert.ok(canModifyAccount(admin, { id: "s2", role: RoleKey.SUPER_ADMIN }));
  assert.equal(canModifyAccount(superAdmin, { id: "s2", role: RoleKey.SUPER_ADMIN }), null);
  assert.equal(canModifyAccount(admin, { id: "c1", role: RoleKey.CUSTOMER }), null);
  assert.ok(canModifyAccount(admin, { id: "a1", role: RoleKey.ADMIN }));

  assert.ok(canGrantRole(RoleKey.ADMIN, RoleKey.SUPER_ADMIN));
  assert.equal(canGrantRole(RoleKey.SUPER_ADMIN, RoleKey.SUPER_ADMIN), null);
  assert.equal(canGrantRole(RoleKey.ADMIN, RoleKey.ADMIN), null);
  assert.equal(canGrantRole(RoleKey.ADMIN, RoleKey.STAFF), null);
});

test("only a super admin may approve administrator access requests", () => {
  assert.ok(canReviewRoleRequest(RoleKey.ADMIN, RoleKey.ADMIN));
  assert.equal(canReviewRoleRequest(RoleKey.SUPER_ADMIN, RoleKey.ADMIN), null);
  assert.equal(canReviewRoleRequest(RoleKey.ADMIN, RoleKey.STAFF), null);
  assert.equal(canReviewRoleRequest(RoleKey.SUPER_ADMIN, RoleKey.STAFF), null);
});

test("an email is never auto-merged into an existing identity", () => {
  // Accounts are first-party and sessions are cookie-bound, so there is no code
  // path that could join two records. Guarded by inspecting the source, because
  // "we removed a feature" is not something a type checker can assert.
  const policy = readFileSync("lib/access-policy.ts", "utf8");
  assert.doesNotMatch(policy, /autoLink|auto-?link/i, "no identity auto-linking may exist");
  // Every lookup by email must be an exact unique match, never a fuzzy bind.
  for (const file of ["lib/auth/sign-in.ts", "lib/auth/team.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /upsert\(\s*\{\s*where:\s*\{\s*email/, `${file} must not upsert by email`);
  }
});

test("returnTo is allowlisted so it cannot become an open redirect", () => {
  const allowed = ["/admin", "/staff", "/customer/dashboard"] as const;
  assert.equal(safeReturnTo("/customer/dashboard", allowed), "/customer/dashboard");
  assert.equal(safeReturnTo("https://evil.example.com", allowed), null);
  assert.equal(safeReturnTo("//evil.example.com", allowed), null);
  assert.equal(safeReturnTo("/customer/dashboard/../admin", allowed), null);
  assert.equal(safeReturnTo(undefined, allowed), null);
});

test("every protected area uses a single sign-in surface", () => {
  // There are deliberately two surfaces: staff authenticate first-party at
  // /sign-in, customers use the provider under /customer/auth. What must never
  // happen is a visitor being bounced to the wrong one, so each area has to
  // resolve to its own surface and the removed provider route must stay gone.
  const proxy = readFileSync("proxy.ts", "utf8");
  const server = readFileSync("lib/auth/server.ts", "utf8");

  assert.ok(proxy.includes('"/sign-in"'), "the staff sign-in route must be referenced");
  // The customer route is built from the shared prefix constant so the edge
  // layer and the provider pages cannot drift apart.
  assert.match(proxy, /CUSTOMER_AUTH_PREFIX\s*=\s*"\/customer\/auth"/, "the customer auth prefix must be declared");
  assert.ok(proxy.includes("`${CUSTOMER_AUTH_PREFIX}/sign-in`"), "the customer sign-in route must be built from that prefix");
  assert.ok(server.includes("/sign-in"), "the staff sign-in route must be referenced by the guard layer");

  // The guard layer sends admins and staff to the password screen. It must never
  // send them to the customer provider.
  assert.doesNotMatch(server, /customer\/auth/, "lib/auth/server.ts must not route a staff member to the customer provider");
  assert.doesNotMatch(server, /admin-authentication/, "the removed provider admin route must stay gone");
  assert.doesNotMatch(proxy, /admin-authentication/, "the removed provider admin route must stay gone");
});

test("the return-path allowlist contains only real workspaces", () => {
  for (const path of ALLOWED_RETURN_PATHS) {
    assert.ok(path.startsWith("/"), `${path} must be a local path`);
    // A leading `//` is protocol-relative, which would leave the site.
    assert.doesNotMatch(path, /^\/\//, `${path} must not be protocol-relative`);
    assert.equal(safeReturnTo(path, ALLOWED_RETURN_PATHS), path);
  }
  assert.equal(safeReturnTo("//evil.example.com", ALLOWED_RETURN_PATHS), null);
  assert.equal(safeReturnTo("/\/\/evil.example.com", ALLOWED_RETURN_PATHS), null);
});

test("every non-usable state has an explanatory destination", () => {
  const states = ["UNAUTHENTICATED", "PENDING_APPROVAL", "REJECTED", "SUSPENDED", "DEACTIVATED", "MFA_REQUIRED"] as const;
  for (const state of states) {
    const path = gatePathForState(state);
    assert.ok(path.startsWith("/"), `${state} must resolve to a path`);
    if (state !== "UNAUTHENTICATED") assert.ok(path !== "/", `${state} must not fall back to the home page`);
  }
});

// ---------------------------------------------------------------- passwords

test("password hashing is salted and verifiable", () => {
  const a = hashPassword("Correct-Horse-Battery-9!");
  const b = hashPassword("Correct-Horse-Battery-9!");
  assert.notEqual(a, b, "each hash must use a fresh salt");
  assert.equal(verifyPassword("Correct-Horse-Battery-9!", a), true);
  assert.equal(verifyPassword("correct-horse-battery-9!", a), false);
  assert.ok(a.startsWith("scrypt$"), "the stored format must record its parameters");
});

test("password verification rejects malformed or absent hashes", () => {
  assert.equal(verifyPassword("anything", null), false);
  assert.equal(verifyPassword("anything", ""), false);
  assert.equal(verifyPassword("anything", "not-a-hash"), false);
  assert.equal(verifyPassword("anything", "scrypt$1$2$3"), false);
  assert.equal(verifyPassword("anything", "scrypt$x$y$z$aa$bb"), false);
  assert.equal(verifyPassword("anything", "bcrypt$16384$8$1$aa$bb"), false);
});

test("the password policy rejects weak and unpredictable choices", () => {
  // Length and composition only: these are decidable without any network call,
  // so they must hold even when the breach service is unreachable.
  const weak = [
    "short1!A", "alllowercase123!", "ALLUPPERCASE123!", "NoDigitsHere!!", "NoSymbols12345",
    "aaaaaaaaaaaa1!A", "qwertyuiop123!", "1234567890123!",
    "Correct Horse 1!", "  Leading1!Spaces", "qwertyuiop12!",
  ];
  for (const candidate of weak) {
    assert.equal(checkPasswordPolicy(candidate).ok, false, `"${candidate}" should be rejected`);
  }
  // A long, unusual passphrase is accepted by the offline rules.
  for (const candidate of ["Correct-Horse-Battery-9!", "Jaffa-Ranch-Sunset-42!", "Marble-Quartz-Verveil-8!"]) {
    assert.equal(checkPasswordPolicy(candidate).ok, true, `"${candidate}" should pass the composition rules`);
  }
});

test("the breach check only ever discloses a five-character hash prefix", async () => {
  const source = readFileSync("lib/auth/password.ts", "utf8");
  // The k-anonymity property: the range endpoint receives `digest.slice(0, 5)`
  // and the full digest is compared locally.
  assert.ok(source.includes("digest.slice(0, 5)"), "only the prefix may be sent");
  assert.ok(source.includes("slice(5)"), "the remainder must be compared locally");
  assert.doesNotMatch(source, /\/range\/\$\{password\}/, "the password must never be put in the URL");
});

test("the breach check fails open so an outage cannot lock everyone out", async () => {
  const { isPasswordBreached } = require("@/lib/auth/password") as typeof import("@/lib/auth/password");
  // An empty string cannot be a real password, but the point here is the control
  // flow: an unreachable service must not report a breach.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  try {
    assert.equal(await isPasswordBreached("Correct-Horse-Battery-9!"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the password policy refuses the account's own identity", () => {
  const result = checkPasswordPolicy("Owner-Jaipur-2026!", { email: "owner@example.com", name: "Owner" });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /name or email/i);
});

test("session tokens are opaque, unique, and hashed to a fixed length", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, "a session token must be long enough to resist guessing");
  assert.doesNotMatch(a, /[+/=]/, "a token must be URL-safe");
  const hash = sha256(a);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, a, "the raw token must never be what gets stored");
});

// ------------------------------------------------------------------- phones
// Only the pure normalising and masking helpers are exercised, never delivery.
const { maskEmail, maskPhone, normalisePhone } = require("@/lib/auth/sms") as typeof import("@/lib/auth/sms");

test("phone numbers normalise to an unambiguous international form", () => {
  assert.equal(normalisePhone("9876543210"), "919876543210");
  assert.equal(normalisePhone("+91 98765 43210"), "919876543210");
  assert.equal(normalisePhone("(91) 987-654-3210"), "919876543210");
  assert.equal(normalisePhone("+1 415 555 0100"), "14155550100");
  assert.equal(normalisePhone("12345"), null, "too short is not a phone number");
  assert.equal(normalisePhone(""), null);
});

test("masking hides most of the identifier", () => {
  const maskedEmail = maskEmail("owner@example.com");
  assert.ok(maskedEmail.includes("@example.com"));
  assert.ok(!maskedEmail.includes("owner"), "the local part must be masked");
  const maskedPhone = maskPhone("+919876543210");
  assert.ok(maskedPhone.includes("43210"));
  assert.ok(!maskedPhone.includes("98765432"), "the number must not be fully visible");
});

// ------------------------------------------------------------ source guards

test("the first-party session core carries no identity-provider dependency", () => {
  // The first-party session core must stay independent of any hosted identity
  // provider. Staff and administrator accounts authenticate with a password and
  // a one-time code, and if the provider could revoke or substitute that session
  // the mandatory second factor would no longer be the boundary it is meant to
  // be. The provider is confined to `lib/auth/clerk.ts` and the customer area.
  const files = [
    "lib/auth/server.ts",
    "lib/auth/session.ts",
    "lib/auth/sign-in.ts",
    "lib/auth/otp.ts",
    "lib/auth/cookie-names.ts",
    "server.mjs",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /@clerk|clerkMiddleware|clerkClient|ClerkProvider/i, `${file} must not depend on a hosted identity provider`);
  }
});

test("the old Clerk-era admin route is still gone", () => {
  // Administrators must not be reachable through the provider at all, so the
  // route that used to host provider sign-in for admins must not come back. The
  // customer area under /customer/auth is deliberate and does exist.
  assert.equal(existsSync("app/(admin)/admin-authentication"), false, "the provider must never be mounted for admins");
  for (const file of ["./app", "./lib", "./components", "./proxy.ts", "./server.mjs"].flatMap(walk)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /admin-authentication/, `${file} still links to the removed provider admin route`);
  }
});

test("the customer provider area only exists where it is meant to", () => {
  // A leftover page pointing at a deleted route is a 404 in production and is
  // invisible to the type checker, so the routes are asserted directly.
  for (const expected of [
    "app/(customer)/customer/auth/sign-in",
    "app/(customer)/customer/auth/sign-up",
    "app/(customer)/customer/auth/complete",
  ]) {
    assert.equal(existsSync(`${expected}/page.tsx`), true, `${expected} is missing`);
  }
  // The old first-party registration screen is superseded, and must not linger
  // as a second way in.
  assert.equal(existsSync("app/(auth)/register"), false, "app/(auth)/register should have been removed");
  // And the old path must still resolve, as a redirect to the provider.
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /LEGACY_REGISTER_PATH\s*=\s*"\/register"/, "the legacy /register alias must be handled in the edge layer");
});

test("every redirect target in the auth layer actually exists", () => {
  // A gate that redirects to a missing page turns a clear denial into a 404.
  // Routes live under layout groups (`app/(auth)/sign-in`, `app/(admin)/admin`),
  // so existence is checked by scanning for a matching `page.tsx` anywhere and
  // ignoring the group segments, which do not appear in the URL.
  const pageRoutes = new Set<string>();
  for (const file of walk("app")) {
    const parts = file.split(/[\\/]/).filter(Boolean);
    if (parts.at(-1) !== "page.tsx") continue;
    const route = parts
      .slice(parts.indexOf("app") + 1, -1)
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      .join("/");
    pageRoutes.add(route ? `/${route}` : "/");
  }
  assert.ok(pageRoutes.size > 10, `route scan found only ${pageRoutes.size} routes, which means it is broken`);

  // Only genuine navigations are checked. A path used as a `startsWith` prefix
  // (e.g. `/customer/bookings`) is not itself a route and must not be matched.
  const redirects = new Set<string>();
  const CALL_SITES = /(?:redirect|location\.assign)\(\s*["'`]([^"'`$]+)["'`]/g;
  for (const file of ["./lib/auth/server.ts", "./lib/auth-actions.ts", "./proxy.ts", "./components/auth/gate.tsx"].flatMap(walk)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL_SITES)) {
      if (match[1].startsWith("/")) redirects.add(match[1]);
    }
  }
  // The action-state `next` field drives a client-side navigation too.
  for (const file of ["./lib/auth-actions.ts", "./lib/auth/server.ts"].flatMap(walk)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/next:\s*[`"'](\/[^`"'${]*)[`"']/g)) {
      redirects.add(match[1]);
    }
  }

  const missing = [...redirects]
    // Drop any query string or hash: only the pathname identifies the route.
    .map((path) => (path.split(/[?#]/)[0] ?? "/").replace(/\/$/, "") || "/")
    .filter((path) => !pageRoutes.has(path));
  assert.ok(redirects.size >= 5, `only ${redirects.size} redirect targets found, which means the scan is broken`);
  assert.deepEqual(missing, [], `redirect targets with no matching route: ${missing.join(", ")}`);
});

test("the session cookie is host-only and http-only", () => {
  // `cookie-names.ts` has no `server-only` and no `next/headers` import, so it
  // loads directly and the naming rule can be asserted as behaviour.
  const names = require("../lib/auth/cookie-names.ts") as typeof import("../lib/auth/cookie-names");

  // The __Host- prefix forces HTTPS, forbids a Domain attribute, and pins Path=/.
  // It is only legal next to `Secure`, so it is used exactly when the request
  // arrived over HTTPS.
  assert.equal(names.sessionCookieName(true), "__Host-event_session");
  assert.equal(names.pendingTwoFactorCookieName(true), "__Host-event_2fa_pending");

  // A plain-http development origin cannot carry `Secure`, so the prefix is
  // dropped there; emitting it anyway makes the browser discard the cookie.
  assert.ok(!names.sessionCookieName(false).startsWith("__Host-"));
  assert.ok(!names.pendingTwoFactorCookieName(false).startsWith("__Host-"));

  // Forwarded protocol wins; without a proxy the deployment mode decides.
  assert.equal(names.isHttps("https", false), true);
  assert.equal(names.isHttps("http", true), false);
  assert.equal(names.isHttps("https, http", false), true);
  assert.equal(names.isHttps(undefined, true), true);
  assert.equal(names.isHttps(undefined, false), false);

  const source = readFileSync("lib/auth/session.ts", "utf8");
  assert.ok(/httpOnly:\s*true/.test(source), "the session cookie must be httpOnly");
  assert.ok(/sameSite:\s*"lax"/.test(source), "the session cookie must be SameSite=Lax");
  // The name and the Secure flag must be decided by the same value, otherwise
  // a `__Host-` cookie would be emitted without Secure and be dropped.
  assert.ok(
    /store\.set\(sessionCookieName\(secure\), token, \{\s*httpOnly: true,\s*secure,/.test(source),
    "the session cookie name and its Secure attribute must come from the same check",
  );
});

test("the pending two-factor cookie is written before any early return in sign-in", () => {
  const source = readFileSync("lib/auth/sign-in.ts", "utf8");

  // A privileged account with no second factor yet returns before a code is
  // ever sent, but /two-factor-setup still has to identify it on the next
  // request. If the cookie were written after that branch the admin would be
  // told "Your account could not be loaded".
  const setCookie = source.indexOf("setPendingTwoFactor({");
  assert.ok(setCookie !== -1, "beginSignIn must write the pending two-factor cookie");
  const privilegedBranch = source.indexOf("privileged && !account.twoFactorEnabledAt");
  assert.ok(privilegedBranch !== -1, "the privileged short-circuit must still exist");
  assert.ok(setCookie < privilegedBranch, "the cookie must be written before the privileged short-circuit returns");
});
