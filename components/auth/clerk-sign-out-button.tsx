"use client";

import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/**
 * Ends the Clerk session and returns to the customer sign-in screen.
 *
 * Needed because the server `auth()` helper has no sign-out method. When a Clerk
 * identity is refused — the address belongs to a staff account, for example —
 * the visitor is still signed in to Clerk, so without this they would bounce
 * from the sign-in screen straight back to the refusal and never be able to pick
 * a different account.
 */
export function ClerkSignOutButton({ label, redirectTo }: { label: string; redirectTo: string }) {
  const clerk = useClerk();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => clerk.signOut({ redirectUrl: redirectTo })}
      disabled={!clerk.loaded}
    >
      {label}
    </Button>
  );
}
