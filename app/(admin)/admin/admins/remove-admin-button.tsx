"use client";

import { useState } from "react";
import { UserMinus } from "lucide-react";
import { removeAdminFormAction } from "@/lib/form-actions";
import { ActionForm } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "Remove" for an administrator, as distinct from "Suspend".
 *
 * Suspending only blocks sign-in and can be undone with one click; removing
 * strips the privilege permanently and demotes the person to a customer. That
 * difference is easy to get wrong by accident, so it is behind a two-step
 * confirmation with the reason recorded in the security log rather than a
 * single button sitting next to "Suspend".
 */
export function RemoveAdminButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} className="text-[var(--danger-text)] hover:bg-[var(--danger-soft)]">
        <UserMinus className="mr-2 h-4 w-4" />
        Remove
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`remove-admin-${userId}`}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl sm:rounded-[28px] sm:p-6"
          >
            <h3 id={`remove-admin-${userId}`} className="text-2xl font-semibold">Remove {name}?</h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              This revokes administrator access immediately and signs the account out everywhere. Their bookings,
              invoices, and audit history are kept, and they keep their account as a customer.
            </p>

            <ActionForm action={removeAdminFormAction} className="mt-5 space-y-4">
              <input type="hidden" name="userId" value={userId} />
              <label className="grid gap-2 text-sm font-medium">
                Reason (recorded in the security log)
                <Input name="reason" placeholder="e.g. Left the organisation" maxLength={200} />
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive">
                  <UserMinus className="mr-2 h-4 w-4" />
                  Remove administrator
                </Button>
              </div>
            </ActionForm>
          </div>
        </div>
      ) : null}
    </>
  );
}