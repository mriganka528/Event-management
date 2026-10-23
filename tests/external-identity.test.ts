import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AccountStatus, RoleKey } from "@prisma/client";
import { resolveExternalIdentityClaim } from "@/lib/access-policy";

/**
 * The claim rule is the account-takeover boundary between the external sign-in
 * provider and local accounts, so it is pinned here case by case.
 */

const ACTIVE_CUSTOMER = { role: RoleKey.CUSTOMER, accountStatus: AccountStatus.ACTIVE, isActive: true, clerkId: null };

test("an unknown address creates a new customer account", () => {
  assert.equal(resolveExternalIdentityClaim({ local: null }), "CREATE");
});

test("an active customer may link their own address", () => {
  assert.equal(resolveExternalIdentityClaim({ local: ACTIVE_CUSTOMER }), "LINK");
});

test("a third-party sign-up can never claim a staff, admin, or super admin account", () => {
  // Anyone can create an account for any address at an identity provider, so
  // each of these would otherwise be a privilege escalation.
  for (const role of [RoleKey.SUPER_ADMIN, RoleKey.ADMIN, RoleKey.STAFF]) {
    assert.equal(
      resolveExternalIdentityClaim({ local: { ...ACTIVE_CUSTOMER, role } }),
      "REFUSE_TEAM_ACCOUNT",
      `a ${role} account must not be claimable through the sign-in provider`,
    );
  }
});

test("a team account stays refused even when it is fully active and verified", () => {
  // The refusal is about the role, not about the account's health: a perfectly
  // good super admin must still not be reachable by provider sign-in.
  assert.equal(
    resolveExternalIdentityClaim({
      local: { role: RoleKey.SUPER_ADMIN, accountStatus: AccountStatus.ACTIVE, isActive: true, clerkId: null },
    }),
    "REFUSE_TEAM_ACCOUNT",
  );
});

test("two provider identities cannot both claim the same address", () => {
  assert.equal(
    resolveExternalIdentityClaim({ local: { ...ACTIVE_CUSTOMER, clerkId: "user_clerk_a" } }),
    "REFUSE_ALREADY_LINKED",
  );
});

test("sign-in never resurrects an inactive customer", () => {
  const inactive = [
    { ...ACTIVE_CUSTOMER, isActive: false },
    { ...ACTIVE_CUSTOMER, accountStatus: AccountStatus.SUSPENDED },
    { ...ACTIVE_CUSTOMER, accountStatus: AccountStatus.REJECTED },
    { ...ACTIVE_CUSTOMER, accountStatus: AccountStatus.PENDING_APPROVAL },
  ];
  for (const local of inactive) {
    assert.equal(
      resolveExternalIdentityClaim({ local }),
      "REFUSE_INACTIVE",
      `${local.accountStatus}/${local.isActive} must not be reactivated by a sign-in`,
    );
  }
});

test("a linked customer is refreshed by identity, never re-claimed by role", () => {
  // Regression guard: the rule must key on the provider id before anything else,
  // so a repeat sign-in takes the refresh path in lib/auth/clerk.ts.
  assert.equal(
    resolveExternalIdentityClaim({ local: { ...ACTIVE_CUSTOMER, clerkId: "user_clerk_a" } }),
    "REFUSE_ALREADY_LINKED",
  );
});

// ---------------------------------------------------------- federation wiring

test("federation can only ever produce a customer account", () => {
  const source = readFileSync("lib/auth/clerk.ts", "utf8");

  // The create path must pin the role rather than read it from the identity.
  assert.ok(/roleId:\s*role\.id/.test(source), "the create must use the resolved CUSTOMER role id");
  assert.ok(
    /key:\s*RoleKey\.CUSTOMER/.test(source),
    "the role lookup must be for CUSTOMER",
  );

  // No write anywhere in this module may touch role, status, or approval.
  for (const forbidden of ["roleId", "accountStatus:", "isActive:", "approvedAt", "approvedById"]) {
    const writes = [...source.matchAll(new RegExp(`update\\([^)]*\\{[\\s\\S]{0,400}?data:\\s*\\{[^}]*?${forbidden}`, "g"))];
    assert.equal(writes.length, 0, `federation must never write ${forbidden} on an existing account`);
  }
});

test("the sign-in provider is not allowed to authorise a staff session", () => {
  // Customers are exchanged for a local session at /customer/auth/complete. A
  // provider that could mint a session for a privileged role would bypass the
  // password and the mandatory second factor entirely.
  const page = readFileSync("app/(customer-auth)/customer/auth/complete/page.tsx", "utf8");
  const exchange = readFileSync("app/api/customer/session/exchange/route.ts", "utf8");

  // Both halves of the exchange live in the route handler: the one place that
  // may both prove who the visitor is and write the cookie.
  assert.ok(
    /federateClerkCustomer\(/.test(exchange),
    "the exchange must go through the federation policy",
  );
  assert.ok(
    /issueSession\(/.test(exchange),
    "the exchange must issue the ordinary local session",
  );

  // The cookie may only be written where the response headers are still mutable.
  // A Server Component renders *into* the response, so `cookies().set()` there
  // throws "Cookies can only be modified in a Server Action or Route Handler" —
  // which is exactly how this started.
  assert.ok(
    !/issueSession\(/.test(page),
    "the Server Component must not mint the session cookie",
  );

  // And the hand-off is a redirect, not a client fetch: no JavaScript sits
  // between the provider and the workspace.
  assert.match(exchange, /relativeRedirectTo\("\/customer\/dashboard", 303\)/);
  assert.match(page, /redirect\(CUSTOMER_SESSION_EXCHANGE_PATH\)/);

  // It must redirect to the customer workspace, never to an admin or staff area.
  for (const source of [page, exchange]) {
    assert.ok(!/\/admin|\/staff/.test(source), "the provider exchange must not redirect into a staff area");
  }
});

test("the happy path of the provider hand-off is answered at the edge", () => {
  // A `redirect()` in a Server Component is delivered as an HTTP 200 carrying a
  // client-side instruction, because the shell has already been flushed by the
  // time the page's first `await` resolves. The browser still downloads a whole
  // document and still needs JavaScript to reach the workspace.
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(
    proxy,
    /pathname === CUSTOMER_COMPLETE_PATH && !searchParams\.has\(EXCHANGE_REFUSAL_PARAM\)[\s\S]{0,200}?redirectTo\(CUSTOMER_SESSION_EXCHANGE_PATH, request\)/,
    "the completion path must be forwarded at the edge when nothing was refused",
  );
  // And it must skip rendering entirely, not render an empty document.
  assert.doesNotMatch(proxy, /NextResponse\.next\(\)[\s\S]{0,80}?CUSTOMER_COMPLETE_PATH/);
});

test("no redirect is addressed to the server's idea of itself", () => {
  // `NextResponse.redirect(new URL(path, request.url))` builds the target from
  // the *process's* idea of its own address rather than the Host the visitor
  // used. Behind the custom server in `server.mjs`, which binds `0.0.0.0`, a
  // request to `http://localhost:3000` yields a base of `http://0.0.0.0:3000`,
  // so every one of these sent browsers to an address that only worked by
  // accident.
  const offenders: string[] = [];
  for (const file of ["proxy.ts", "app/api/customer/session/exchange/route.ts"]) {
    const source = readFileSync(file, "utf8");
    for (const at of source.matchAll(/NextResponse\.redirect\(\s*new URL\(([^)]*)\)/g)) {
      if (at[1].includes("request.url")) offenders.push(`${file}: ${at[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `redirects must not be based on request.url:\n  ${offenders.join("\n  ")}`);
});

test("the edge builds its redirects from the Host the visitor used", () => {
  // Next.js validates the `Location` it gets back from middleware and rejects a
  // relative one with `ERR_INVALID_URL`, so this cannot be the relative form the
  // route handler uses. The origin therefore has to come from the request, not
  // from a configured site URL — `NEXT_PUBLIC_SITE_URL` is optional and is unset
  // in most local setups, so relying on it would send local redirects to the
  // wrong port.
  const helper = readFileSync("lib/http-redirect.ts", "utf8");
  assert.match(helper, /export function redirectTo\(path: string, request: NextRequest/);
  assert.match(helper, /request\.headers\.get\("host"\)/, "the Host header is the only correct base");
  assert.match(helper, /x-forwarded-proto/, "a TLS-terminating proxy makes the internal hop plain http");

  // The relative form stays available for route handlers, where it is both legal
  // and better: the browser resolves it against the URL it just requested.
  assert.match(helper, /export function relativeRedirectTo/);
  assert.match(helper, /headers: \{ Location: path \}/);
});

test("a refused provider sign-up cannot loop between the exchange and the explanation", () => {
  // The exchange redirects back to the completion page carrying a code, and the
  // page renders only because of that code. Without the rule, a refused identity
  // would bounce between them forever.
  const page = readFileSync("app/(customer-auth)/customer/auth/complete/page.tsx", "utf8");
  const exchange = readFileSync("app/api/customer/session/exchange/route.ts", "utf8");

  assert.match(page, /if \(!refusal\)[\s\S]{0,80}?redirect\(CUSTOMER_SESSION_EXCHANGE_PATH\);/, "the page must only redirect when nothing was refused");

  // The code crosses the redirect as a query parameter, so it must be looked up
  // in a fixed table rather than rendered back into the page.
  const shared = readFileSync("lib/auth/customer-exchange.ts", "utf8");
  assert.match(shared, /hasOwnProperty/, "an unrecognised code must resolve to nothing, not be echoed");
  assert.match(shared, /EXCHANGE_REFUSAL_PARAM = "error"/);
  assert.match(exchange, /customerExchangeRefusal\(code\)/, "the exchange must tag its refusals through the shared helper");
  assert.match(page, /EXCHANGE_REFUSAL_PARAM/);
});
