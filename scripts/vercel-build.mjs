import { spawnSync } from "node:child_process";

/**
 * Vercel build entry point.
 *
 * Migrations are deliberately limited to production deployments. Preview
 * deployments often inherit a DATABASE_URL that points at the production
 * database; running `prisma migrate deploy` there lets a pull request change the
 * live schema. A preview that really has its own database can opt in with
 * ALLOW_PREVIEW_MIGRATIONS=true.
 */

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const production = process.env.VERCEL_ENV === "production";
const allowPreview = process.env.ALLOW_PREVIEW_MIGRATIONS === "true";

run("npx", ["prisma", "generate"]);

if (production || allowPreview) {
  run("npx", ["prisma", "migrate", "deploy"]);
} else {
  console.log("[vercel-build] Preview or local build: skipping prisma migrate deploy.");
}

run("npx", ["next", "build"]);
