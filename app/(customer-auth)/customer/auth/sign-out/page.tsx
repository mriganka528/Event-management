import type { Metadata } from "next";
import { CustomerSignOutPanel } from "@/components/auth/customer-sign-out-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Signing out",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The second half of a customer sign-out.
 *
 * `signOutAction` revokes the local session and redirects here, inside the Clerk
 * provider, so the provider session can be ended from its own client. Without
 * this screen the provider session survived a sign-out and the sign-in page only
 * ever showed "you are already signed in".
 */
export default function CustomerSignOutPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 text-center shadow-sm sm:p-8">
        <CustomerSignOutPanel />
      </div>
    </main>
  );
}
