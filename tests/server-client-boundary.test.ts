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

/**
 * The other direction across the same boundary: not a *call* into a client
 * module, but a *prop* carrying one.
 *
 *   Error: Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * The landing page did this with `renderItem={(item) => <Card … />}` on the
 * packages and gallery carousels: the page is a Server Component and `Carousel`
 * is a client one, so the arrow function had nowhere to cross. It compiled, type
 * checked, and threw on every visit to `/`.
 *
 * It is only legal *between* client components, where a render prop is a normal
 * prop — so the fix is a client wrapper that owns the markup and takes plain data,
 * not a `"use server"` on the callback.
 */
test("no server component hands a function to a client component", () => {
  /** Names a server file imports from a "use client" module. */
  function clientImports(file: string): Set<string> {
    const names = new Set<string>();
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/import\s+(?!type\s)\{([^}]*)\}\s+from\s+"@\/([^"]+)"/g)) {
      const resolved = join(root, m[2].slice(2));
      if (!existsSync(resolved) || !isClientModule(resolved)) continue;
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        // Only components: a lowercase helper is the *call* guard's business.
        if (name && /^[A-Z]/.test(name)) names.add(name);
      }
    }
    return names;
  }

  const problems: string[] = [];
  for (const file of files) {
    if (!/\.tsx$/.test(file) || isClientModule(file)) continue;
    const source = readFileSync(file, "utf8");

    for (const name of clientImports(file)) {
      for (const element of source.matchAll(new RegExp(`<${name}\\b([\\s\\S]*?)(?:/>|</${name}>)`, "g"))) {
        for (const prop of element[1].matchAll(/\s([a-zA-Z][a-zA-Z0-9]*)=\{/g)) {
          // `children` is markup, and markup crosses the boundary fine.
          if (prop[1] === "children") continue;
          const value = element[1].slice(prop.index + prop[0].length - 1);
          if (/^\s*(?:\(\s*[\w$]*\s*\)?\s*=>|async\s*\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(value)) {
            problems.push(`${file}: <${name} ${prop[1]}={…}>`);
          }
        }
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    `only serialisable props cross into a client component — wrap the render in a client component instead:\n  ${problems.join("\n  ")}`,
  );
});

test("the carousels render on the client side of the boundary", () => {
  // The wrappers that fixed it: each one owns the markup, and the page passes
  // data. `Carousel` keeps its render prop, which is legal between two clients.
  const page = readFileSync("app/(root)/page.tsx", "utf8");
  assert.doesNotMatch(page, /<Carousel\b/, "the landing page must not call the carousel directly");
  assert.match(page, /<PackageCarousel packages=\{packages\}/);
  assert.match(page, /<GalleryCarousel images=\{galleryImages\}/);

  for (const wrapper of ["components/marketing/package-carousel.tsx", "components/marketing/gallery-carousel.tsx"]) {
    const source = readFileSync(wrapper, "utf8");
    assert.ok(isClientModule(wrapper), `${wrapper} must be a client module, or the render prop cannot cross`);
    assert.match(source, /renderItem=/, `${wrapper} should own the markup rather than push it back up`);
  }
});
