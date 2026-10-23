import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";

/**
 * Clerk is needed only by the customer sign-in, sign-up, exchange, and sign-out
 * screens.
 *
 * Mounting the provider at the root made every page — including the admin
 * workspace and the statically generated marketing pages — carry Clerk's client
 * script. Keeping it on this subtree leaves the rest of the app on the
 * first-party session stack.
 *
 * This group sits outside `(customer)/customer`, so these screens do not
 * inherit the customer workspace header. That header is server-rendered from the
 * local session and would say "Sign in" while Clerk was still signed in — the
 * contradiction that made the already-signed-in screen so confusing.
 */
export default function CustomerAuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>;
}
