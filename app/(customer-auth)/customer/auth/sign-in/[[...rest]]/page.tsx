import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerAuthPanel } from "@/components/auth/customer-auth-panel";
import { CustomerAuthShell } from "@/components/auth/customer-auth-shell";
import { HOME_BY_ROLE, getAuthContext, isSignedIn } from "@/lib/auth/server";

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
 *
 * The Clerk widget is rendered by `CustomerAuthPanel`, which shows a loading
 * state while Clerk's script boots, the form once it has, and an actionable
 * error if it never arrives. It also handles the case where a Clerk session is
 * already live — which used to make the form disappear entirely, because Clerk
 * redirects a signed-in visitor away from this page.
 */
export default async function CustomerSignInPage() {
  // A local session means this visitor is already signed in. Sending them back
  // to the form made the header say "Sign in" and the form say "you are already
  // signed in" at the same time — the contradiction this page used to show.
  if (await isSignedIn()) {
    const context = await getAuthContext();
    if (context.user) redirect(HOME_BY_ROLE[context.user.role]);
  }

  return (
    <CustomerAuthShell
      eyebrow="Customer sign in"
      title="Welcome back"
      description="Use Google or the email address you booked with. New here? You can create an account from the same form."
      footer={
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--card)] px-4 py-4 text-center shadow-sm sm:px-5">
          <p className="text-xs leading-5 text-[var(--muted)]">
            Staff, administrator, or super administrator accounts use a password and a one-time code instead.
          </p>
          <div className="mt-3 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <Link
              href="/sign-in"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-4 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
            >
              Staff sign in
            </Link>
            <Link
              href="/join-the-team"
              className="inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-medium text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)]"
            >
              Request team access
            </Link>
          </div>
        </div>
      }
    >
      <CustomerAuthPanel
        mode="sign-in"
        path="/customer/auth/sign-in"
        signUpUrl="/customer/auth/sign-up"
        fallbackRedirectUrl="/customer/auth/complete"
      />
    </CustomerAuthShell>
  );
}
