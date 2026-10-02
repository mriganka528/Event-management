import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { federateClerkCustomer } from "@/lib/auth/clerk";
import { issueSession } from "@/lib/auth/sign-in";
import { requestIp } from "@/lib/auth/server";
import { AuthFeedback } from "@/components/auth/auth-feedback";
import { ClerkSignOutButton } from "@/components/auth/clerk-sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Finishing sign in",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Exchanges a verified Clerk session for the local session the rest of the
 * application uses.
 *
 * From here on the customer is indistinguishable from a first-party account: the
 * edge proxy, the Socket.IO handshake, the device limit, and every booking query
 * keep working without knowing that Clerk was involved at all.
 */
export default async function CustomerAuthCompletePage() {
  const user = await currentUser();
  if (!user) redirect("/customer/auth/sign-in");

  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  const ipAddress = await requestIp();

  const federated = await federateClerkCustomer(
    {
      clerkId: user.id,
      email: primary?.emailAddress ?? "",
      firstName: user.firstName ?? user.username ?? "",
      lastName: user.lastName ?? null,
      imageUrl: user.imageUrl ?? null,
    },
    ipAddress,
  );

  // The address belongs to a staff account, a suspended account, or a different
  // identity. No local session is minted, and the visitor stays signed in to
  // Clerk, so the screen offers an explicit sign-out to escape the loop.
  if (!federated.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 pt-6">
            <AuthFeedback state={{ status: "error", error: federated.message }} />
            <p className="text-sm text-[var(--muted)]">
              Staff and administrator accounts sign in with an email address and password, not Google.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/sign-in">
                <Button variant="outline" size="sm">Staff sign in</Button>
              </Link>
              <ClerkSignOutButton label="Use a different account" redirectTo="/customer/auth/sign-in" />
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Customers hold no second factor, so the session is issued directly. It still
  // goes through the shared path, which enforces the per-account device cap and
  // writes the sign-in to the security log.
  const session = await issueSession({ userId: federated.userId, channel: null, ipAddress, deviceId: null });
  if (!session.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 pt-6">
            <AuthFeedback state={{ status: "error", error: session.message }} />
            <div className="flex flex-wrap items-center gap-3">
              <ClerkSignOutButton label="Sign out" redirectTo="/customer/auth/sign-in" />
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  redirect("/customer/dashboard");
}
