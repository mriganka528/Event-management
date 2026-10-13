import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Customer sign in",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Customer sign-in, hosted by Clerk.
 *
 * The path is deliberately not Clerk's default `/sign-in`, because that route
 * belongs to the first-party staff sign-in. A successful sign-in lands on
 * `/customer/auth/complete`, which exchanges the Clerk session for the ordinary
 * local one that the rest of the application already understands.
 */
export default function CustomerSignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Use Google, or the email address you booked with.</p>
        </div>
        <SignIn
          routing="path"
          path="/customer/auth/sign-in"
          signUpUrl="/customer/auth/sign-up"
          forceRedirectUrl="/customer/auth/complete"
          fallbackRedirectUrl="/customer/auth/complete"
        />
      </div>
    </main>
  );
}
