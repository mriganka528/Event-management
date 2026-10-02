import "dotenv/config";
import { stdin, stdout } from "node:process";
import { PrismaClient, AccountStatus, RoleKey, SecurityEventType } from "@prisma/client";
import { hashPassword, assertPasswordAcceptable } from "../lib/auth/password";
import { normalisePhone } from "../lib/auth/sms";
import { splitLine } from "./console-line";

const prisma = new PrismaClient();

/**
 * Creates (or re-credentials) the first SUPER_ADMIN, so you can sign in at
 * /sign-in with an email and a password.
 *
 * Run it with no arguments and it asks for everything interactively:
 *
 *   npm run admin:bootstrap
 *
 * This stays a CLI command rather than a route because it is the only path
 * that provisions an administrator without a prior approval step. It records
 * the action in the security audit log.
 *
 * Non-interactive use is still supported for CI and scripted deploys, by
 * setting the same values in the environment:
 *
 *   BOOTSTRAP_ADMIN_EMAIL="owner@example.com" \
 *   BOOTSTRAP_ADMIN_PASSWORD="..." \
 *   BOOTSTRAP_ADMIN_PHONE="+91 98765 43210" \
 *   npm run admin:bootstrap
 *
 * Password rules are whatever `lib/auth/password` enforces everywhere else.
 * Two-factor enrolment is NOT done here: a privileged account is sent to
 * /two-factor-setup after its first successful password sign-in, and the admin
 * panel stays closed until that is finished.
 */

/**
 * Minimal terminal reader.
 *
 * `readline`'s `hideEchoBack` is typed as `Abortable` and is not part of the
 * documented options, so hidden input is handled directly here instead of
 * relying on it. Only a name and passwords are ever typed, so the whole surface
 * is a line editor: printable keys, backspace, Ctrl+C/Ctrl+D, and Enter.
 *
 * One `data` listener is attached for the lifetime of the reader and every
 * chunk is buffered. A prompt that attaches and detaches its own listener
 * instead would discard input that arrived in the same chunk as a newline,
 * which loses an answer whenever the user types ahead or stdin is piped.
 */
class Console {
  private buffer = "";
  private pending: ((line: string) => void) | null = null;
  private raw = false;
  private readonly wasRaw: boolean;
  private readonly tty: NodeJS.ReadStream & { setRawMode?: (raw: boolean) => void };

  constructor() {
    this.tty = stdin;
    this.wasRaw = Boolean((stdin as { isRaw?: boolean }).isRaw);
    stdin.on("data", (chunk) => this.onData(chunk.toString("utf8")));
    stdin.on("end", () => this.settle(true));
    stdin.resume();
  }

  private onData(text: string) {
    if (this.raw) {
      if (text.includes("\u0003")) {
        // Ctrl+C: put the terminal back before the default handler runs.
        this.tty.setRawMode?.(this.wasRaw);
        process.exit(130);
      }
      // Erase on backspace/delete so the line behaves like a normal editor.
      text = text.replace(/[\u007f\u0008]/g, "");
    }
    this.buffer += text;
    this.settle(false);
  }

  /** Hands the next complete line to whoever is waiting, if any. */
  private settle(atEof: boolean) {
    if (!this.pending) return;
    const split = splitLine(this.buffer);
    if (!split) {
      // Ctrl+D on an empty line means "no answer given".
      if (atEof || this.buffer === "\u0004") {
        this.buffer = "";
        const resolve = this.pending;
        this.pending = null;
        resolve("");
      }
      return;
    }
    this.buffer = split.rest;
    const resolve = this.pending;
    this.pending = null;
    resolve(split.line);
  }

  private nextLine(): Promise<string> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.settle(false);
    });
  }

  /** `hidden` input is not echoed, so shoulder-surfing cannot capture it. */
  async ask(query: string, hidden = false): Promise<string> {
    stdout.write(query);
    if (hidden) this.raw = true;
    this.tty.setRawMode?.(hidden ? true : this.wasRaw);
    try {
      const answer = await this.nextLine();
      if (hidden) stdout.write("\n");
      return answer.trim();
    } finally {
      this.raw = false;
      this.tty.setRawMode?.(this.wasRaw);
    }
  }
}


const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function banner() {
  console.log("");
  console.log("  Super admin setup");
  console.log("  -----------------");
  console.log("  Press Enter to accept the default shown in [brackets].");
  console.log("");
}

/** Interactive run. Everything is asked for; nothing is echoed as a secret. */
async function promptForDetails() {
  const io = new Console();
  banner();

  let email = "";
  for (;;) {
    email = (await io.ask("  Admin email: ")).trim().toLowerCase();
    if (!email) return null; // Ctrl+D / empty line: nothing to do.
    if (isEmail(email)) break;
    console.log("    That does not look like an email address.\n");
  }

  const name = (await io.ask("  Full name  [Owner]: ")) || "Owner";
  const rawPhone = (await io.ask("  Phone (optional, for SMS 2FA): ")).trim();
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalisePhone(rawPhone);
    if (!phone) {
      console.log("    That phone number was not recognised; continuing without it.");
      phone = null;
    }
  }

  // Ask twice so a typo cannot silently lock the operator out.
  let password = "";
  for (;;) {
    const first = await io.ask("  Password  (12+ chars, upper/lower/number/symbol): ", true);
    if (first.length < 12) {
      console.log("    Use at least 12 characters.\n");
      continue;
    }
    const second = await io.ask("  Confirm password: ", true);
    if (first !== second) {
      console.log("    The two entries did not match.\n");
      continue;
    }
    const policy = await assertPasswordAcceptable(first, { email, name });
    if (!policy.ok) {
      console.log(`    ${policy.message}\n`);
      continue;
    }
    password = first;
    break;
  }

  return { email, name, phone, password };
}

async function main() {
  // An environment-only run keeps working for CI and scripted deploys, but it
  // is only used when the environment is actually complete. A half-set
  // environment used to skip the prompts and then fail on a missing password,
  // which is a confusing way to say "no email and password were given".
  const forceNoPrompt = process.argv.includes("--no-input");
  const envEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const envPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const envComplete = Boolean(envEmail && envPassword);
  const interactive = !forceNoPrompt && Boolean(stdin.isTTY);

  if (interactive && envEmail && !envComplete) {
    console.log("  BOOTSTRAP_ADMIN_EMAIL is set but BOOTSTRAP_ADMIN_PASSWORD is not,");
    console.log("  so the environment is incomplete. Ignoring it and prompting instead.\n");
  }

  let email: string;
  let name: string;
  let phone: string | null;
  let password: string;

  if (envComplete) {
    if (!isEmail(envEmail)) throw new Error("BOOTSTRAP_ADMIN_EMAIL is not a valid email address.");
    email = envEmail;
    name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Owner";
    const rawPhone = process.env.BOOTSTRAP_ADMIN_PHONE?.trim();
    phone = rawPhone ? normalisePhone(rawPhone) : null;
    password = envPassword;
    const policy = await assertPasswordAcceptable(password, { email, name });
    if (!policy.ok) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD rejected: ${policy.message}`);
  } else if (!interactive) {
    console.log("No interactive terminal, and BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD");
    console.log("are not both set. Set both, or run this directly in a terminal to be prompted.");
    return;
  } else {
    const answers = await promptForDetails();
    if (!answers) {
      console.log("\n  Cancelled. Nothing was created.\n");
      return;
    }
    ({ email, name, phone, password } = answers);
  }

  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: { key: RoleKey.SUPER_ADMIN }, isActive: true },
    select: { email: true },
  });
  // Re-running for the same address is a password reset, not a second account.
  if (existingSuperAdmin && existingSuperAdmin.email !== email) {
    console.log(`\n  A super admin already exists: ${existingSuperAdmin.email}`);
    console.log("  Refusing to create a second one. Invite more admins from /admin/admins after signing in.\n");
    return;
  }

  // The four system roles come from `npm run db:seed`. Reaching here without them
  // means the schema was pushed but never seeded, which is a normal first-run
  // state — so it is reported as the next command to run rather than as a crash.
  const role = await prisma.role.findUnique({ where: { key: RoleKey.SUPER_ADMIN } });
  if (!role) {
    console.log("\n  The database has no system roles, so there is nothing to attach the account to.");
    console.log("  This happens on a fresh database: the schema exists but was never seeded.\n");
    console.log("    npm run db:seed          # creates the four roles and empty business settings");
    console.log("    npm run admin:bootstrap\n");
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  const [firstName, ...rest] = name.split(/\s+/);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      roleId: role.id,
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
      approvedAt: now,
      suspendedAt: null,
      suspensionReason: null,
      // 2FA is not marked as enabled here: the operator must prove they can
      // receive a code before the guard lets them past.
      twoFactorEnabledAt: null,
      ...(phone ? { phone } : {}),
      // The account owner vouched for this address out of band, so it counts as
      // verified. Without this the password sign-in is refused outright with
      // EMAIL_UNVERIFIED (lib/auth/sign-in.ts) and the account is unusable.
      emailVerifiedAt: now,
      passwordHash: hashPassword(password),
      passwordChangedAt: now,
      mustSetPassword: false,
      failedSignInCount: 0,
    },
    create: {
      email,
      firstName: firstName || name,
      lastName: rest.join(" ") || null,
      ...(phone ? { phone } : {}),
      roleId: role.id,
      accountStatus: AccountStatus.ACTIVE,
      approvedAt: now,
      emailVerifiedAt: now,
      passwordHash: hashPassword(password),
      passwordChangedAt: now,
      mustSetPassword: false,
      adminProfile: { create: {} },
    },
    include: { adminProfile: true },
  });
  if (!user.adminProfile) await prisma.admin.create({ data: { userId: user.id } });

  await prisma.securityEvent.create({
    data: {
      type: SecurityEventType.ACCOUNT_APPROVED,
      userId: user.id,
      email: user.email,
      detail: "Super admin provisioned out of band by admin:bootstrap.",
    },
  });

  console.log(`\n  Super admin ready: ${user.email}`);
  if (phone) console.log(`  Phone on file:     ${phone} (used for SMS two-factor)`);
  console.log("");
  console.log("  Next:");
  console.log(`  1. Sign in at /sign-in with ${email} and the password you just set.`);
  console.log("  2. Enrol a second factor. This step has no skip, and /admin stays");
  console.log("     closed until it is done - that check lives in lib/auth/server.ts.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
