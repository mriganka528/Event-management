import "dotenv/config";
import { PrismaClient, AccountStatus, SecurityEventType } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Removes every login while keeping all business history intact.
 *
 * WHY NOT JUST DELETE
 * -------------------
 * A `Customer` row owns booking history, and `Booking` owns payments, invoices,
 * and inventory reservations. Deleting a user therefore cascades into
 * `Customer` and destroys real financial records. Instead this script:
 *
 *   1. hard-deletes the auth-only rows (sessions, OTPs, activation tokens),
 *   2. anonymises every remaining user: no password, no PII, deactivated,
 *      rejected, and with the email address scrambled,
 *   3. leaves `Customer`, `Booking`, `Payment`, and `Invoice` untouched.
 *
 * The scrambled email is a deterministic, collision-free placeholder, so
 * re-running is safe and a re-registered customer cannot inherit the old
 * account's history.
 *
 *   npm run auth:reset -- --confirm
 */
async function main() {
  const confirm = process.argv.includes("--confirm") || process.env.AUTH_RESET_CONFIRM === "1";
  if (!confirm) {
    console.log("This removes every login. Nothing will happen without confirmation.");
    console.log("Re-run with:  npm run auth:reset -- --confirm");
    return;
  }

  const totals = await prisma.$transaction(async (tx) => {
    const authSessions = await tx.authSession.deleteMany({});
    const otpChallenges = await tx.otpChallenge.deleteMany({});
    const activationTokens = await tx.activationToken.deleteMany({});
    const loginAttempts = await tx.loginAttempt.deleteMany({});

    const users = await tx.user.findMany({ select: { id: true } });
    let anonymised = 0;
    for (const user of users) {
      // Deriving the placeholder from the id keeps it unique and collision-free
      // even when two accounts previously shared an address.
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: `removed+${user.id}@removed.invalid`,
          phone: null,
          phoneVerifiedAt: null,
          firstName: "Removed",
          lastName: null,
          avatarUrl: null,
          passwordHash: null,
          mustSetPassword: false,
          emailVerifiedAt: null,
          twoFactorChannel: null,
          twoFactorEnabledAt: null,
          passwordChangedAt: null,
          lastLoginAt: null,
          lastLoginIp: null,
          signInCount: 0,
          failedSignInCount: 0,
          isActive: false,
          accountStatus: AccountStatus.REJECTED,
          suspensionReason: "Accounts were removed by the auth reset script.",
          suspendedAt: new Date(),
        },
      });
      anonymised += 1;
    }

    await tx.securityEvent.create({
      data: {
        type: SecurityEventType.SIGN_OUT,
        detail: `auth:reset removed ${authSessions.count} session(s) and anonymised ${anonymised} account(s). Business history preserved.`,
      },
    });

    return { authSessions: authSessions.count, otpChallenges: otpChallenges.count, activationTokens: activationTokens.count, loginAttempts: loginAttempts.count, anonymised };
  });

  console.log("Accounts removed.");
  console.log(`  sessions revoked:   ${totals.authSessions}`);
  console.log(`  one-time codes:    ${totals.otpChallenges}`);
  console.log(`  activation links:  ${totals.activationTokens}`);
  console.log(`  sign-in attempts:  ${totals.loginAttempts}`);
  console.log(`  accounts cleared:  ${totals.anonymised}`);
  console.log("");
  console.log("Bookings, payments, invoices, and inventory were NOT touched.");
  console.log("Any account that is still active here had no login to begin with.");
  console.log("");
  console.log("Create the first super admin next:");
  console.log('  BOOTSTRAP_ADMIN_EMAIL="owner@example.com" npm run admin:bootstrap');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
