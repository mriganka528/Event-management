import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerAuthPanel } from "@/components/auth/customer-auth-panel";
import { CustomerAuthShell } from "@/components/auth/customer-auth-shell";
import { HOME_BY_ROLE, getAuthContext, isSignedIn } from "@/lib/auth/server";

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
 *
 * The Clerk widget is rendered by `CustomerAuthPanel`, which shows a loading
 * state while Clerk's script boots, the form once it has, and an actionable
 * error if it never arrives. It also handles the case where a Clerk session is
 * already live, so the page never silently bounces away.
 */
export default async function CustomerSignUpPage() {
  if (await isSignedIn()) {
    const context = await getAuthContext();
    if (context.user) redirect(HOME_BY_ROLE[context.user.role]);
  }

  return (
    <CustomerAuthShell
      eyebrow="Customer account"
      title="Create your account"
      description="Track bookings, download invoices, and keep your event details together. It only takes a minute."
      footer={
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--card)] px-4 py-4 text-center shadow-sm sm:px-5">
          <p className="text-xs leading-5 text-[var(--muted)]">
            Joining as staff or an administrator? Request team access and a super admin will review it.
          </p>
          <div className="mt-3 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <Link
              href="/join-the-team"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-4 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
            >
              Request team access
            </Link>
            <Link
              href="/customer/auth/sign-in"
              className="inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-medium text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)]"
            >
              I already have an account
            </Link>
          </div>
        </div>
      }
    >
      <CustomerAuthPanel
        mode="sign-up"
        path="/customer/auth/sign-up"
        signInUrl="/customer/auth/sign-in"
        fallbackRedirectUrl="/customer/auth/complete"
      />
    </CustomerAuthShell>
  );
}
