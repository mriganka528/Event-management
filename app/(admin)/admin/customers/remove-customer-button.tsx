"use client";

import { useState } from "react";
import { UserMinus } from "lucide-react";
import { removeCustomerFormAction } from "@/lib/form-actions";
import { ActionForm } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "Remove" for a customer, as distinct from "Suspend".
 *
 * Suspending only blocks sign-in and can be undone; removing erases the name,
 * contact details, credentials, and sign-in-provider link for good. The
 * difference is easy to trigger by accident next to a one-click action, so it
 * sits behind a confirmation that spells out what survives — the bookings,
 * payments, and invoices stay on every revenue and booking screen.
 *
 * Only rendered for a super admin; the server action re-checks that regardless,
 * because a hidden control is not an authorisation decision.
 */
export function RemoveCustomerButton({ customerId, name, bookings }: { customerId: string; name: string; bookings: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"
      >
        <UserMinus className="mr-2 h-4 w-4" />
        Remove
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`remove-customer-${customerId}`}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl sm:rounded-[28px] sm:p-6"
          >
            <h3 id={`remove-customer-${customerId}`} className="text-2xl font-semibold">Remove {name}?</h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              This erases their name, email address, phone number, and sign-in immediately, and signs them out
              everywhere. This cannot be undone.
            </p>

            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-sm">
              <p className="font-semibold text-[var(--foreground)]">What is kept</p>
              <p className="mt-1 text-[var(--muted)]">
                {bookings === 0
                  ? "This customer has no bookings."
                  : `${bookings} booking${bookings === 1 ? "" : "s"}, with every payment and invoice, stays in the history and keeps counting towards revenue.`}
              </p>
            </div>

            <ActionForm action={removeCustomerFormAction} className="mt-5 space-y-4">
              <input type="hidden" name="customerId" value={customerId} />
              <label className="grid gap-2 text-sm font-medium">
                Reason (recorded in the security log)
                <Input name="reason" placeholder="e.g. Customer requested erasure" maxLength={200} />
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive">
                  <UserMinus className="mr-2 h-4 w-4" />
                  Remove customer
                </Button>
              </div>
            </ActionForm>
          </div>
        </div>
      ) : null}
    </>
  );
}