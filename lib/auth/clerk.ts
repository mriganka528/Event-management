import "server-only";

import { AccountStatus, RoleKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSecurityEvent } from "@/lib/security-audit";
import { resolveExternalIdentityClaim } from "@/lib/access-policy";

/**
 * Clerk federation for customers.
 *
 * WHY FEDERATION
 * -------------
 * Staff and administrator accounts authenticate first-party: a `scrypt` password
 * plus a mandatory one-time code, with a database-backed session and an audited
 * device limit. Customers are much lower risk — they can only ever see their own
 * bookings — so they are allowed to delegate identity to Clerk (Google or email).
 *
 * Rather than teach every page, the edge proxy, and the Socket.IO handshake about
 * a second kind of session, a Clerk sign-in is exchanged here for exactly the
 * same `AuthSession` row and cookie the rest of the application already
 * understands. Clerk is the credential store; this module is the only place
 * where a Clerk identity is allowed to become a local account.
 *
 * PRIVILEGE CONTAINMENT
 * ---------------------
 * This function can only ever produce a `CUSTOMER`. It never writes `roleId`,
 * `accountStatus`, `isActive`, or any approval field on an account that already
 * exists, so a Clerk sign-up cannot be used to claim a staff account, reactivate
 * a suspended one, or inherit a role. A local account holding a privileged role
 * is refused outright rather than linked, which is what stops someone from
 * signing up through Clerk with `owner@thebusiness.com` and inheriting the
 * super admin's workspace.
 */

export type ClerkIdentity = {
  clerkId: string;
  email: string;
  firstName: string;
  lastName: string | null;
  imageUrl: string | null;
};

export type FederateResult = { ok: true; userId: string; created: boolean } | { ok: false; reason: "EMAIL_TAKEN" | "ACCOUNT_BLOCKED" | "INVALID_EMAIL"; message: string };

function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/**
 * Exchanges a verified Clerk identity for a local `CUSTOMER` account.
 *
 * Safe to call repeatedly: signing in again on a known Clerk identity refreshes
 * the profile fields rather than creating a second account.
 */
export async function federateClerkCustomer(identity: ClerkIdentity, ipAddress: string | null): Promise<FederateResult> {
  const clerkId = identity.clerkId.trim();
  if (!clerkId) return { ok: false, reason: "INVALID_EMAIL", message: "That account could not be linked. Try again." };

  const email = normaliseEmail(identity.email);
  if (!email) return { ok: false, reason: "INVALID_EMAIL", message: "That account has no usable email address." };

  // Already linked: refresh the mutable profile fields only. Role, status and
  // approval are deliberately absent from this update.
  const linked = await prisma.user.findUnique({ where: { clerkId }, select: { id: true, email: true } });
  if (linked) {
    if (linked.email === email) {
      await prisma.user.update({
        where: { id: linked.id },
        data: { firstName: identity.firstName, lastName: identity.lastName, avatarUrl: identity.imageUrl },
      });
    } else {
      // Clerk is the source of truth for a federated address, so a change made
      // there is mirrored locally. Uniqueness is still enforced, and the local
      // address can only be freed by a privileged account.
      const conflict = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (conflict && conflict.id !== linked.id) {
        return { ok: false, reason: "EMAIL_TAKEN", message: "That email address is already linked to another account." };
      }
      await prisma.user.update({
        where: { id: linked.id },
        data: { email, firstName: identity.firstName, lastName: identity.lastName, avatarUrl: identity.imageUrl, emailVerifiedAt: new Date() },
      });
    }
    return { ok: true, userId: linked.id, created: false };
  }

  const byEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, clerkId: true, isActive: true, accountStatus: true, firstName: true, lastName: true, avatarUrl: true, role: { select: { key: true } } },
  });

  // The decision itself is a pure policy so it can be unit-tested; see
  // `resolveExternalIdentityClaim` in lib/access-policy.ts.
  const claim = resolveExternalIdentityClaim({
    local: byEmail ? { role: byEmail.role.key, accountStatus: byEmail.accountStatus, isActive: byEmail.isActive, clerkId: byEmail.clerkId } : null,
  });

  if (claim === "REFUSE_TEAM_ACCOUNT" && byEmail) {
    await recordSecurityEvent({
      type: "SIGN_IN_BLOCKED",
      userId: byEmail.id,
      email,
      ipAddress,
      detail: "A third-party sign-up tried to claim a staff account's address.",
    });
    return { ok: false, reason: "ACCOUNT_BLOCKED", message: "That email address belongs to a staff account. Sign in with your password instead." };
  }
  if (claim === "REFUSE_ALREADY_LINKED") {
    return { ok: false, reason: "ACCOUNT_BLOCKED", message: "That account is already linked to a different sign-in method." };
  }
  if (claim === "REFUSE_INACTIVE") {
    return { ok: false, reason: "ACCOUNT_BLOCKED", message: "This account is not active. Contact us for help." };
  }

  if (claim === "LINK" && byEmail) {
    // An existing, active customer claiming their own address. Link it, leaving
    // the booking history attached to the same row. A field Clerk does not
    // supply keeps whatever the account already had.
    await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        clerkId,
        firstName: identity.firstName || byEmail.firstName,
        lastName: identity.lastName ?? byEmail.lastName,
        avatarUrl: identity.imageUrl ?? byEmail.avatarUrl,
        emailVerifiedAt: new Date(),
      },
    });
    await recordSecurityEvent({ type: "ACCESS_REQUEST_SUBMITTED", userId: byEmail.id, email, ipAddress, detail: "Existing customer account linked to a third-party identity." });
    return { ok: true, userId: byEmail.id, created: false };
  }

  const role = await prisma.role.findUnique({ where: { key: RoleKey.CUSTOMER }, select: { id: true } });
  if (!role) return { ok: false, reason: "ACCOUNT_BLOCKED", message: "Customer sign-in is unavailable right now." };

  const user = await prisma.user.create({
    data: {
      email,
      clerkId,
      firstName: identity.firstName || "Customer",
      lastName: identity.lastName,
      avatarUrl: identity.imageUrl,
      roleId: role.id,
      // Clerk has already verified this address (and Google verified it before
      // that), so the account is usable immediately and needs no approval gate.
      accountStatus: AccountStatus.ACTIVE,
      approvedAt: new Date(),
      emailVerifiedAt: new Date(),
      // No password hash: this account authenticates through Clerk only.
      mustSetPassword: false,
      customerProfile: { create: {} },
    },
    select: { id: true },
  });

  await recordSecurityEvent({ type: "ACCESS_REQUEST_SUBMITTED", userId: user.id, email, ipAddress, detail: "Customer account created from a third-party identity." });
  return { ok: true, userId: user.id, created: true };
}

/** Reads the Clerk identity for the current request, or null when signed out. */
export async function readClerkIdentity(): Promise<ClerkIdentity | null> {
  const { auth, clerkClient } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return null;
  // `auth()` proves the Clerk session; the profile is read from the backend so a
  // stale claim cannot pin an old email or name to a local account.
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if (!user) return null;
  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  return {
    clerkId: user.id,
    email: primary?.emailAddress ?? "",
    firstName: user.firstName ?? user.username ?? "",
    lastName: user.lastName ?? null,
    imageUrl: user.imageUrl ?? null,
  };
}
