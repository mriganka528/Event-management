"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Ends the Clerk session and returns to the customer sign-in screen.
 *
 * Needed because the server `auth()` helper has no sign-out method. When a Clerk
 * identity is refused — the address belongs to a staff account, for example —
 * the visitor is still signed in to Clerk, so without this they would bounce
 * from the sign-in screen straight back to the refusal and never be able to pick
 * a different account.
 *
 * The provider call is a network round trip, so the button shows that it was
 * pressed rather than looking inert.
 */
export function ClerkSignOutButton({ label, redirectTo }: { label: string; redirectTo: string }) {
  const clerk = useClerk();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        if (pending) return;
        setPending(true);
        clerk.signOut({ redirectUrl: redirectTo }).catch(() => {
          // The provider did not answer, so the session may still be live.
          // Releasing the button lets the visitor retry rather than sending
          // them to a page that would only bounce them back here.
          setPending(false);
        });
      }}
      disabled={!clerk.loaded || pending}
      aria-busy={pending || undefined}
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? "Signing you out…" : label}
    </Button>
  );
}
