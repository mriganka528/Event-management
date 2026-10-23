"use client";

import { useMemo, useState } from "react";
import { CreditCard } from "lucide-react";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { recordPaymentFormAction } from "@/lib/form-actions";
import { advancePaymentPreset, paymentPresets } from "@/lib/payment-requests";
import { formatCurrency } from "@/lib/utils";

export type ManualPaymentBooking = {
  id: string;
  label: string;
  totalAmount: number;
  paidAmount: number;
  availableBalance: number;
};

/**
 * The admin's payment form with 25% / 50% / full quick-fill buttons. The buttons
 * are calculations only: the amount still goes through the same server-side
 * validation as a typed figure. Changing the booking recalculates the presets
 * from that booking's live total, paid, and available balance.
 */
export function ManualPaymentForm({ bookings, idempotencyKey }: { bookings: ManualPaymentBooking[]; idempotencyKey: string }) {
  const [bookingId, setBookingId] = useState(bookings[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("ADVANCE");
  const selected = bookings.find((booking) => booking.id === bookingId) ?? bookings[0];
  const selectedId = selected?.id ?? "";

  const presets = useMemo(() => {
    if (!selected) return [];
    const calculated = paymentPresets({
      totalAmount: selected.totalAmount,
      paidAmount: selected.paidAmount,
      balanceAmount: selected.availableBalance,
    });
    const advance = advancePaymentPreset({
      totalAmount: selected.totalAmount,
      balanceAmount: selected.availableBalance,
    });
    // Keep the one-click 25% advance even after the first 25% was paid. The
    // cumulative half preset can describe the same rupee amount at that point,
    // so an equal duplicate is dropped rather than shown twice.
    return advance && !calculated.some((preset) => preset.key === "ADVANCE")
      ? [advance, ...calculated.filter((preset) => Math.abs(preset.amount - advance.amount) >= 0.01)]
      : calculated;
  }, [selected]);

  return (
    <ActionForm action={recordPaymentFormAction} className="grid gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label className="grid gap-2 text-sm font-medium">
        Booking
        <Select
          name="bookingId"
          value={selectedId}
          onChange={(event) => {
            setBookingId(event.target.value);
            setAmount("");
            setStage("ADVANCE");
          }}
          options={bookings.map((booking) => ({ label: booking.label, value: booking.id }))}
        />
      </label>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Quick fill</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setAmount(String(preset.amount));
                setStage(preset.stage);
              }}
            >
              {preset.label} · {formatCurrency(preset.amount)}
            </Button>
          ))}
        </div>
        {presets.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">This booking is fully settled or has no available balance.</p>
        ) : (
          <p className="text-xs text-[var(--muted)]">25% is calculated from the booking total; the half button is 50% of the remaining balance. Use Full balance to settle the booking.</p>
        )}
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Amount
        <Input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="25000"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Stage
          <Select name="stage" value={stage} onChange={(event) => setStage(event.target.value)} options={[{ label: "Advance / part payment", value: "ADVANCE" }, { label: "Final settlement", value: "FINAL" }]} />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Method
          <Select name="method" options={[{ label: "Cash", value: "CASH" }, { label: "UPI", value: "UPI" }, { label: "Card", value: "CARD" }, { label: "Net banking", value: "NETBANKING" }]} />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Reference
        <Input name="reference" placeholder="Transaction reference" />
      </label>
      <SubmitButton>
        <CreditCard className="mr-2 h-4 w-4" />
        Record payment
      </SubmitButton>
    </ActionForm>
  );
}
