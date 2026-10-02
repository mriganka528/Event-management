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
  const source = readFileSync("app/(customer)/customer/auth/complete/page.tsx", "utf8");
  assert.ok(/federateClerkCustomer\(/.test(source), "the exchange must go through the federation policy");
  assert.ok(/issueSession\(/.test(source), "the exchange must issue the ordinary local session");
  // It must redirect to the customer workspace, never to an admin or staff area.
  assert.ok(!/\/admin|\/staff/.test(source), "the provider exchange must not redirect into a staff area");
});
