import { spawn } from "node:child_process";

/**
 * Vercel build entry point.
 *
 * Migrations are deliberately limited to production deployments. Preview
 * deployments often inherit a DATABASE_URL that points at the production
 * database; running `prisma migrate deploy` there lets a pull request change the
 * live schema. A preview that really has its own database can opt in with
 * ALLOW_PREVIEW_MIGRATIONS=true.
 *
 * Prisma uses a session-level advisory lock while migrating. Two production
 * builds can overlap (a redeploy while the previous one is still running), and
 * Prisma gives the second one only ten seconds to acquire the lock. That is the
 * P1002 failure seen on Vercel even when the database itself is healthy. The
 * retry below waits for the other build to finish instead of failing the
 * deployment outright. `prisma.config.ts` points the CLI at the direct database
 * host, which is the other half of the fix: the pooled host cannot reliably
 * hold that advisory lock.
 */

const production = process.env.VERCEL_ENV === "production";
const allowPreview = process.env.ALLOW_PREVIEW_MIGRATIONS === "true";

/** Run a command, streaming both streams, and resolve with its output. */
function spawnAndCollect(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: process.platform === "win32",
      stdio: ["inherit", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

async function run(command, args, env) {
  const result = await spawnAndCollect(command, args, env);
  if (result.code !== 0) process.exit(result.code ?? 1);
}

/**
 * `migrate deploy` is idempotent: if another deployment already applied the
 * migrations, a retry simply finds nothing left to do. Only retry the advisory
 * lock timeout; a real schema error should fail immediately.
 */
async function migrate() {
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await spawnAndCollect("npx", ["prisma", "migrate", "deploy"]);
    if (result.code === 0) return;

    const lockBusy = /P1002|advisory lock|Timed out trying to acquire/i.test(result.output);
    if (!lockBusy || attempt === attempts) {
      process.exit(result.code ?? 1);
    }

    const waitMs = attempt * 5_000;
    console.warn(
      `[vercel-build] The migration lock is busy; retrying in ${waitMs / 1_000}s ` +
        `(attempt ${attempt}/${attempts}).`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

await run("npx", ["prisma", "generate"]);

if (production || allowPreview) {
  await migrate();
} else {
  console.log("[vercel-build] Preview or local build: skipping prisma migrate deploy.");
}

await run("npx", ["next", "build"]);
