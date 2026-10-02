"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RazorpayCheckout({ bookingId, amount, businessName = "Event Management" }: { bookingId: string; amount: number; businessName?: string }) {
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

  async function startPayment() {
    setLoading(true);
    setMessage(null);
    const idempotencyKey = `checkout_${bookingId}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    try {
      const response = await fetch("/api/payments/razorpay/order", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ bookingId, idempotencyKey }) });
      const order = (await response.json()) as { keyId?: string; providerOrderId?: string; amountPaise?: number; currency?: string; prefill?: RazorpayOptions["prefill"]; error?: string };
      if (!response.ok || !order.keyId || !order.providerOrderId || !order.amountPaise) throw new Error(order.error ?? "Unable to start secure checkout.");
      if (!window.Razorpay) throw new Error("Secure checkout is still loading. Try again in a moment.");
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency ?? "INR",
        name: businessName,
        description: `Balance payment for booking ${bookingId.slice(0, 8).toUpperCase()}`,
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

  if (paid) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="mb-2 h-5 w-5" />{message}</div>;

  return (
    <div className="space-y-2">
      <Button type="button" className="w-full" disabled={!ready || loading || amount <= 0} onClick={() => void startPayment()}>
        {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
        {loading ? "Processing securely…" : `Pay ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount)} online`}
      </Button>
      {message ? <p className="text-xs leading-5 text-[var(--muted)]">{message}</p> : <p className="text-xs leading-5 text-[var(--muted)]">You will be redirected to Razorpay&apos;s secure test checkout.</p>}
    </div>
  );
}
