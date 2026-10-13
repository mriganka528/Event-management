import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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
 *
 * This route is an **optional catch-all** (`[[...rest]]`) on purpose. Clerk's
 * `routing="path"` owns a whole subtree under the mount path: it pushes
 * `continue`, `factor-one`, and the callback states as real URLs. Without the
 * catch-all, `<SignIn/>` throws at runtime with "The '/customer/auth/sign-in'
 * route is not a catch-all route" the moment it looks for its own sub-route.
 */
export default function CustomerSignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Customer sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Use Google, or the email address you booked with.</p>
        </div>
        <SignIn
          routing="path"
          path="/customer/auth/sign-in"
          signUpUrl="/customer/auth/sign-up"
          forceRedirectUrl="/customer/auth/complete"
          fallbackRedirectUrl="/customer/auth/complete"
        />
        <div className="flex flex-col items-center gap-3 border-t border-[var(--line)] pt-5 text-center">
          <p className="text-xs text-[var(--muted)]">
            Staff, administrator, or super administrator accounts use a password and a one-time code instead.
          </p>
          <Link href="/sign-in">
            <Button variant="outline" size="sm">Staff sign in</Button>
          </Link>
          <Link href="/auth-choice">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />Back to account options
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}