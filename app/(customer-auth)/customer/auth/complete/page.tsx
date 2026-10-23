import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFeedback } from "@/components/auth/auth-feedback";
import { ClerkSignOutButton } from "@/components/auth/clerk-sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EXCHANGE_REFUSAL_PARAM, exchangeRefusalMessage } from "@/lib/auth/customer-exchange";

/**
 * Kept in step with `proxy.ts`, which performs the same hop at the edge. Both
 * exist so the hand-off survives a deployment that does not run the proxy.
 */
const CUSTOMER_SESSION_EXCHANGE_PATH = "/api/customer/session/exchange";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Finishing sign in",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The screen that explains a refused customer sign-in.
 *
 * On the happy path this page does not render at all. The local session cookie
 * can only be written from a Server Action or a Route Handler, and a Server
 * Component runs while Next.js is still assembling the response, so
 * `cookies().set()` here is rejected with "Cookies can only be modified in a
 * Server Action or Route Handler". `proxy.ts` therefore forwards this path
 * straight to `/api/customer/session/exchange`, which mints the cookie and
 * points the browser at the workspace.
 *
 * That endpoint redirects back here when it refuses, carrying a code, and this
 * time there is something to say. The presence of the code is what stops the
 * loop: without it the page redirects on, with it the page stays put, so a
 * refused identity can never bounce between the two.
 *
 * The code is looked up in a fixed table rather than rendered, because it
 * arrives in a query string; see `lib/auth/customer-exchange.ts`.
 */
export default async function CustomerAuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = params[EXCHANGE_REFUSAL_PARAM];
  const refusal = exchangeRefusalMessage(typeof code === "string" ? code : undefined);

  // Reached without a proxy (a deployment that does not run one, or a direct
  // fetch of this path): forward to the exchange by hand so the cookie is still
  // minted rather than silently skipped.
  if (!refusal) {
    redirect(CUSTOMER_SESSION_EXCHANGE_PATH);
  }

  // The address belongs to a staff account, a suspended account, or a different
  // identity. No local session is minted, and the visitor stays signed in to
  // Clerk, so the screen offers an explicit sign-out to escape the loop.
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <AuthFeedback state={{ status: "error", error: refusal }} />
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