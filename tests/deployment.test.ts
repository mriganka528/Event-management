import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * A preview deployment must never migrate the database just because it inherited
 * the production DATABASE_URL. Production is the only environment allowed to run
 * `prisma migrate deploy` by default; a preview with its own database can opt in.
 */

test("preview builds do not run production migrations", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.equal(vercel.buildCommand, "node scripts/vercel-build.mjs");

  const build = readFileSync("scripts/vercel-build.mjs", "utf8");
  assert.match(build, /process\.env\.VERCEL_ENV === "production"/);
  assert.match(build, /process\.env\.ALLOW_PREVIEW_MIGRATIONS === "true"/);
  assert.match(build, /if \(production \|\| allowPreview\)/);
  assert.match(build, /run\("npx", \["prisma", "migrate", "deploy"\]\)/);
  assert.match(build, /skipping prisma migrate deploy/);
  assert.match(build, /run\("npx", \["next", "build"\]\)/);
});

test("a database snapshot can be taken before a restore or migration", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["db:backup"], "node scripts/db-backup.mjs");
  assert.match(readFileSync(".gitignore", "utf8"), /^\/backups\/$/m, "snapshots contain production rows and must stay out of git");
  assert.match(readFileSync("scripts/db-backup.mjs", "utf8"), /isolationLevel: "RepeatableRead"/);
});
