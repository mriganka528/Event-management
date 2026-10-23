import Link from "next/link";
import { Banknote, Check, X } from "lucide-react";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { approveCashPaymentFormAction, rejectCashPaymentFormAction } from "@/lib/form-actions";
import { formatCurrency, formatDate } from "@/lib/utils";

export type PendingCashClaim = {
  id: string;
  bookingId: string;
  amount: number | string;
  createdAt: Date | string;
  customerName: string;
  bookingLocation: string;
  balance: number | string;
};

/**
 * Cash declarations are deliberately not part of the payment history: until an
 * admin approves one, the money has not been received. This panel is the only
 * place the team can turn a claim into a captured payment.
 */
export function PendingCashApprovals({ claims, title = "Cash payments awaiting approval" }: { claims: PendingCashClaim[]; title?: string }) {
  if (claims.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-[var(--brand-dark)]" />
          {title}
        </CardTitle>
        <CardDescription>
          A cash declaration does not change the booking balance until you approve it. Confirm the cash was received before approving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {claims.map((claim) => (
          <div key={claim.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--foreground)]">{formatCurrency(claim.amount)} declared in cash</p>
                <p className="mt-1 break-words text-sm text-[var(--muted)]">
                  {claim.customerName} · {claim.bookingLocation}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Declared {formatDate(claim.createdAt)} · Balance before approval {formatCurrency(claim.balance)}
                </p>
              </div>
              <Link href={`/admin/bookings/${claim.bookingId}`} className="text-sm font-semibold text-[var(--brand-dark)] underline-offset-4 hover:underline">
                Open booking
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionForm action={approveCashPaymentFormAction}>
                <input type="hidden" name="paymentId" value={claim.id} />
                <SubmitButton size="sm" pendingLabel="Approving…">
                  <Check className="mr-2 h-4 w-4" />
                  Approve cash
                </SubmitButton>
              </ActionForm>
              <ActionForm action={rejectCashPaymentFormAction}>
                <input type="hidden" name="paymentId" value={claim.id} />
                <SubmitButton size="sm" variant="outline" pendingLabel="Rejecting…">
                  <X className="mr-2 h-4 w-4" />
                  Reject
                </SubmitButton>
              </ActionForm>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
