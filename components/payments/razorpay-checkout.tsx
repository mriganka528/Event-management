"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, CreditCard, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { declareCashPaymentFormAction } from "@/lib/form-actions";

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/**
 * Razorpay checkout for one booking.
 *
 * `amount` is the full outstanding balance. `requestedAmount` is the remainder of
 * an instalment the team asked for; when it is smaller it becomes its own button,
 * so the customer can settle the request without accidentally paying everything.
 * The server re-derives both figures — these props only decide what is offered.
 */
export function RazorpayCheckout({
  bookingId,
  amount,
  requestedAmount = null,
  requestedLabel = null,
  businessName = "Event Management",
  pendingCashAmount = null,
}: {
  bookingId: string;
  amount: number;
  requestedAmount?: number | null;
  requestedLabel?: string | null;
  businessName?: string;
  pendingCashAmount?: number | null;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout="true"]');
    if (existing) {
      setReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => setReady(true);
    script.onerror = () => setMessage("Secure checkout could not be loaded. Try again shortly.");
    document.body.appendChild(script);
  }, []);

  const installment = requestedAmount !== null && requestedAmount >= 0.01 && requestedAmount < amount - 0.01 ? requestedAmount : null;

  const cashForm = (cashAmount: number) => (
    <ActionForm action={declareCashPaymentFormAction}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="amount" value={cashAmount} />
      <SubmitButton variant="outline" className="w-full" pendingLabel="Submitting…" disabled={pendingCashAmount !== null}>
        <Banknote className="mr-2 h-4 w-4" />
        {pendingCashAmount !== null ? "Cash declaration awaiting approval" : `I paid ${currency.format(cashAmount)} in cash`}
      </SubmitButton>
    </ActionForm>
  );

  async function startPayment(payAmount: number) {
    setLoading(true);
    setMessage(null);
    const idempotencyKey = `checkout_${bookingId}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    try {
      const response = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ bookingId, idempotencyKey, amount: payAmount }),
      });
      const order = (await response.json()) as { keyId?: string; providerOrderId?: string; amountPaise?: number; currency?: string; prefill?: RazorpayOptions["prefill"]; error?: string };
      if (!response.ok || !order.keyId || !order.providerOrderId || !order.amountPaise) throw new Error(order.error ?? "Unable to start secure checkout.");
      if (!window.Razorpay) throw new Error("Secure checkout is still loading. Try again in a moment.");
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency ?? "INR",
        name: businessName,
        description: installment !== null ? `Requested installment for booking ${bookingId.slice(0, 8).toUpperCase()}` : `Balance payment for booking ${bookingId.slice(0, 8).toUpperCase()}`,
        order_id: order.providerOrderId,
        prefill: order.prefill,
        notes: { bookingId },
        theme: { color: "#d38a16" },
        handler: async (result) => {
          setLoading(true);
          try {
            const verifyResponse = await fetch("/api/payments/razorpay/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) });
            const payload = (await verifyResponse.json()) as { error?: string };
            if (!verifyResponse.ok) throw new Error(payload.error ?? "Payment verification is still processing.");
            setPaid(true);
            setMessage("Payment received. Your balance has been updated.");
            router.refresh();
          } catch (verificationError) {
            setMessage(verificationError instanceof Error ? verificationError.message : "Payment verification is still processing.");
          } finally {
            setLoading(false);
          }
        },
        modal: { ondismiss: () => setLoading(false) },
      });
      checkout.open();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start payment.");
      setLoading(false);
    }
  }

  if (paid) return <div className="rounded-2xl border border-[var(--success-soft)] bg-[var(--success-soft)] p-4 text-sm text-[var(--success-text)]"><CheckCircle2 className="mb-2 h-5 w-5" />{message}</div>;

  if (amount <= 0) return null;

  return (
    <div className="space-y-2">
      {installment !== null ? (
        <>
          <Button type="button" className="w-full" disabled={!ready || loading} onClick={() => void startPayment(installment)}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
            {loading ? "Opening secure checkout…" : `Pay ${currency.format(installment)} requested`}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={!ready || loading} onClick={() => void startPayment(amount)}>
            Pay full balance {currency.format(amount)}
          </Button>
          <div className="border-t border-[var(--line)] pt-3">
            <div className="grid gap-2">
              {cashForm(installment)}
              {cashForm(amount)}
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Choose a cash option only after handing the cash to our team. The amount is added to your booking after an admin confirms receipt.
            </p>
          </div>
          <p className="text-xs leading-5 text-[var(--muted)]">
            {requestedLabel ? `${requestedLabel} requested by the team. ` : "The team requested a part payment. "}
            You can pay just the requested amount now and the rest later.
          </p>
        </>
      ) : (
        <>
          <Button type="button" className="w-full" disabled={!ready || loading} onClick={() => void startPayment(amount)}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
            {loading ? "Opening secure checkout…" : `Pay ${currency.format(amount)} online`}
          </Button>
          <div className="border-t border-[var(--line)] pt-3">
            {cashForm(amount)}
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Choose this only after handing the cash to our team. The amount is added to your booking after an admin confirms receipt.
            </p>
          </div>
          <p className="text-xs leading-5 text-[var(--muted)]">You will be redirected to Razorpay&apos;s secure checkout.</p>
        </>
      )}
      {message ? <p className="text-xs leading-5 text-[var(--danger-text)]">{message}</p> : null}
    </div>
  );
}
