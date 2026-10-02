import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { formatRoleLabel } from "@/lib/role-label";

/**
 * Server / client boundary guard.
 *
 * On the server, every export of a module marked `"use client"` is replaced by a
 * stub that throws when called. React is happy to *render* a component through
 * that reference, but a plain function called from a Server Component blows up:
 *
 *   Error: Attempted to call formatRoleLabel() from the server but
 *   formatRoleLabel is on the client.
 *
 * That is not theoretical: it threw on every admin, staff, and customer page, so
 * signing in after the second factor succeeded and then failed on the workspace
 * behind it. The failure only appears at runtime, long after a successful sign-in.
 */

const ROOTS = ["app", "components", "lib"];
const files: string[] = [];
function walk(target: string) {
  if (!existsSync(target)) return;
  if (statSync(target).isFile()) {
    files.push(target);
    return;
  }
  for (const entry of readdirSync(target)) walk(join(target, entry));
}
for (const root of ROOTS) walk(root);

const root = process.cwd();
const isClientModule = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

/** Client modules mapped to the names they export that are not components. */
function clientHelperExports(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || !isClientModule(file)) continue;
    const source = readFileSync(file, "utf8");
    const names = new Set<string>();
    for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
    for (const m of source.matchAll(/export\s+(?:const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
    for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) {
        if (/^\s*type\b/.test(part)) continue;
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    // Anything capitalised is treated as a component, which is safe to render
    // from the server. Only lowercase helpers are a hazard.
    const helpers = [...names].filter((name) => /^[a-z_$]/.test(name));
    if (helpers.length) map.set(file, helpers);
  }
  return map;
}

test("no server component calls a helper exported from a client module", () => {
  const helpers = clientHelperExports();
  const problems: string[] = [];

  for (const file of files) {
    if (!/\.tsx?$/.test(file) || isClientModule(file)) continue;
    const source = readFileSync(file, "utf8");

    for (const m of source.matchAll(/import\s+(?!type\s)(?:\{([^}]*)\}|([A-Za-z0-9_$]+))\s+from\s+"([^"]+)"/g)) {
      const specifier = m[3];
      if (!specifier.startsWith("@/")) continue;
      const resolved = join(root, specifier.slice(2));
      if (!existsSync(resolved)) continue;
      const exported = helpers.get(relative(root, resolved));
      if (!exported) continue;

      const imported = (m[1] ?? m[2] ?? "")
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim())
        .filter(Boolean);
      for (const name of imported) {
        if (exported.includes(name)) problems.push(`${file} imports ${name} from ${specifier}, a "use client" module`);
      }
    }
  }

  assert.deepEqual(problems, [], `server components must not call into a client module:\n  ${problems.join("\n  ")}`);
});

test("the role label helper is usable from both sides", () => {
  // The regression: this used to live in `components/auth/account-menu.tsx`,
  // which is a client module, and the three workspace layouts called it.
  assert.equal(formatRoleLabel("SUPER_ADMIN"), "super admin");
  assert.equal(formatRoleLabel("CUSTOMER"), "customer");

  const source = readFileSync("lib/role-label.ts", "utf8");
  // Match the directive itself, not the words "use client" inside the comment.
  assert.doesNotMatch(source, /^\s*["']use client["']/m, "the shared helper must stay outside the client boundary");

  // No layout may reach past the plain module for it.
  for (const layout of ["app/(admin)/admin/layout.tsx", "app/(staff)/staff/layout.tsx", "app/(customer)/customer/layout.tsx"]) {
    assert.doesNotMatch(
      readFileSync(layout, "utf8"),
      /import\s*\{[^}]*formatRoleLabel[^}]*\}\s*from\s*"@\/components\/auth\/account-menu"/,
      `${layout} must import formatRoleLabel from @/lib/role-label`,
    );
  }
});