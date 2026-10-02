import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Create a customer account",
  robots: { index: false, follow: false, nocache: true },
};

/** Customer registration, hosted by Clerk. See the sibling sign-in page. */
export default function CustomerSignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Create an account</h1>
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
      </div>
    </main>
  );
}
