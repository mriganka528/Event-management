import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Create a customer account",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Customer registration, hosted by Clerk.
 *
 * Optional catch-all for the same reason as the sibling sign-in route: Clerk's
 * path routing owns the nested routes beneath its mount path, and mounting a
 * bare `page.tsx` there makes `<SignUp/>` throw at runtime.
 */
export default function CustomerSignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Create a customer account</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Track your bookings, download invoices, and manage your details.
          </p>
        </div>
        <SignUp
          routing="path"
          path="/customer/auth/sign-up"
          signInUrl="/customer/auth/sign-in"
          forceRedirectUrl="/customer/auth/complete"
          fallbackRedirectUrl="/customer/auth/complete"
        />
        <div className="flex flex-col items-center gap-3 border-t border-[var(--line)] pt-5 text-center">
          <p className="text-xs text-[var(--muted)]">
            Joining as staff or an administrator? Use the team request form instead — it needs approval from a
            super admin.
          </p>
          <Link href="/join-the-team">
            <Button variant="outline" size="sm">Request team access</Button>
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