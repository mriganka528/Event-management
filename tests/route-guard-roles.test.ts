import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { isAdminRole } from "@/lib/access-policy";
import { RoleKey } from "@prisma/client";

/**
 * `AuthUser.role` is the `RoleKey` enum itself, not a Prisma `Role` row.
 *
 * Reaching for `.key` on it is the mistake that produces
 *
 *   Property 'key' does not exist on type 'RoleKey'.
 *     Property 'key' does not exist on type '"SUPER_ADMIN"'.
 *
 * The two shapes come from different queries and sit next to each other all over
 * the codebase, so it is easy to write `user.role.key` for a value that came from
 * `requireApiAdmin()` when it came from a Prisma `select` instead. The guards
 * already decide the role, so the correct code compares the enum directly; these
 * tests make the wrong one impossible to reintroduce unnoticed.
 */

function walk(target: string): string[] {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).flatMap((entry) => walk(join(target, entry)));
}

const sourceFiles = [...walk("app"), ...walk("lib")].filter((file) => /\.tsx?$/.test(file) && !file.includes(`${join(".", "node_modules")}`));

/** Code only. A comment that *names* the mistake must not trip the guard. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*"))
    .join("\n");
}

/** Files that hold a value returned by one of the `requireApi*` guards. */
function filesHoldingAnApiIdentity(): string[] {
  const pattern = /requireApi(Admin|SuperAdmin|Staff|Customer|User)\s*\(/;
  return sourceFiles.filter((file) => pattern.test(code(file)));
}

test("the inventory route reads the guard's role as a RoleKey, never as a Role row", () => {
  const route = code("app/api/inventory/route.ts");
  // The exact failure the report described.
  assert.doesNotMatch(route, /\.role\.key\b/, "AuthUser.role is a RoleKey; `.role.key` does not exist on it");
  assert.match(route, /const role: RoleKey = caller\.role;/, "the route should bind the role with its enum type");

  // And it is compared against the enum, which is the only comparison that type-checks.
  assert.match(route, /role !== RoleKey\.SUPER_ADMIN && role !== RoleKey\.ADMIN/);
});

test("no route handler treats a guarded identity's role as a Prisma row", () => {
  const problems: string[] = [];
  for (const file of filesHoldingAnApiIdentity()) {
    const text = code(file);
    // `record.role.key` is correct for a `select: { role: { select: { key: true } } }`,
    // but the guarded identity is the one object where it is a type error.
    const guarded = [...text.matchAll(/(?:const|let)\s+(\w+)(?:\s*:[^=]+)?\s*=\s*await\s+requireApi\w+\s*\(/g)].map((m) => m[1]);
    for (const name of guarded) {
      const re = new RegExp(`\\b${name}\\.role\\.key\\b`);
      if (re.test(text)) problems.push(`${relative(".", file)}: ${name}.role.key`);
    }
  }
  assert.deepEqual(problems, [], `AuthUser.role is a RoleKey:\n  ${problems.join("\n  ")}`);
});

test("the guard returns the enum, and the enum is what the guards compare", () => {
  const guards = code("lib/route-guards.ts");
  assert.match(guards, /user\.role !== RoleKey\.SUPER_ADMIN/, "the super admin guard compares the enum");
  assert.match(guards, /isAdminRole\(user\.role\)/, "the admin guard compares the enum");
  assert.doesNotMatch(guards, /user\.role\.key/);

  // The shape itself, asserted directly so the reason for the rule is on record.
  const role: RoleKey = RoleKey.SUPER_ADMIN;
  assert.equal(isAdminRole(role), true);
  assert.equal((role as { key?: string }).key, undefined);
});

test("a Prisma role row still exposes .key, which is where the two shapes meet", () => {
  // `server.ts` flattens the relation into the enum on purpose. If somebody
  // "simplifies" `mapUser` to keep the relation, every `.role.key` consumer in
  // `lib/access-management.ts` and the admin pages must break loudly instead.
  const server = code("lib/auth/server.ts");
  assert.match(server, /role:\s*record\.role\.key/, "AuthUser.role stays a RoleKey");
  assert.match(server, /role:\s*RoleKey;/, "the AuthUser type keeps role as the enum");

  // A value that really is a role row, for contrast.
  const row = { key: RoleKey.ADMIN } as const;
  assert.equal(row.key, RoleKey.ADMIN);
  assert.equal(isAdminRole(row.key), true);
});