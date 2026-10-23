import Link from "next/link";
import { Banknote, CreditCard, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

/**
 * One row in a booking's payment ledger.
 *
 * The shape is deliberately loose about the money/date types: Prisma returns
 * `Decimal` and `Date`, while the customer dashboard flattens the same rows
 * with a booking label attached. Formatting happens here so every surface
 * labels a pending cash declaration, a captured advance, and a final
 * settlement the same way.
 */
export type PaymentHistoryItem = {
  id: string;
  amount: number | string | { toString(): string };
  status: "PENDING" | "CAPTURED" | "FAILED" | "REFUNDED";
  stage: "ADVANCE" | "FINAL";
  method: "UPI" | "CARD" | "NETBANKING" | "CASH";
  provider?: "MANUAL" | "RAZORPAY" | null;
  reference?: string | null;
  paidAt?: Date | string | null;
  createdAt?: Date | string | null;
  bookingLabel?: string;
  bookingHref?: string;
};

const statusLabel: Record<PaymentHistoryItem["status"], string> = {
  CAPTURED: "Received",
  PENDING: "Awaiting approval",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

const statusClass: Record<PaymentHistoryItem["status"], string> = {
  CAPTURED: "bg-[var(--success-soft)] text-[var(--success-text)]",
  PENDING: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  FAILED: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  REFUNDED: "bg-[var(--surface-strong)] text-[var(--muted)]",
};

function methodLabel(method: PaymentHistoryItem["method"]) {
  return method === "NETBANKING" ? "Net banking" : method.charAt(0) + method.slice(1).toLowerCase();
}

function paymentDate(payment: PaymentHistoryItem) {
  if (payment.paidAt) return formatDate(payment.paidAt);
  if (payment.createdAt) return `Declared ${formatDate(payment.createdAt)}`;
  return "Date not recorded";
}

function paymentIcon(status: PaymentHistoryItem["status"]) {
  if (status === "PENDING") return Banknote;
  if (status === "CAPTURED") return ReceiptText;
  return CreditCard;
}

export function PaymentHistory({
  payments,
  emptyMessage = "No payments have been recorded for this booking yet.",
  showBooking = false,
}: {
  payments: PaymentHistoryItem[];
  emptyMessage?: string;
  showBooking?: boolean;
}) {
  if (payments.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {payments.map((payment) => {
        const Icon = paymentIcon(payment.status);
        return (
          <div
            key={payment.id}
            className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--card)] text-[var(--brand-dark)]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[var(--foreground)]">{formatCurrency(payment.amount)}</p>
                    <Badge className={statusClass[payment.status]}>{statusLabel[payment.status]}</Badge>
                    <Badge className="bg-[var(--card)] text-[var(--muted-strong)]">
                      {payment.stage === "ADVANCE" ? "Advance / part" : "Final"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {methodLabel(payment.method)} · {payment.provider === "RAZORPAY" ? "Razorpay" : "Manual"}
                  </p>
                  {showBooking && payment.bookingLabel ? (
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {payment.bookingHref ? (
                        <Link href={payment.bookingHref} className="font-medium text-[var(--brand-dark)] underline-offset-4 hover:underline">
                          {payment.bookingLabel}
                        </Link>
                      ) : (
                        payment.bookingLabel
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-sm text-[var(--muted)] sm:text-right">
                <p>{paymentDate(payment)}</p>
                <p className={cn("break-all", !payment.reference?.trim() && "italic")}>
                  {payment.reference?.trim() || "No reference"}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
