import { PaymentRequestMode } from "@prisma/client";

/**
 * Payment scheduling for approved bookings.
 *
 * The team can ask for a 25% deposit, half of whatever is still owed, or the
 * full balance. The request is stored as a *cumulative paid target* rather than
 * a fixed amount to collect, which keeps instalments coherent: if ₹25,000 has
 * already been paid and half of the ₹75,000 balance is requested, the customer
 * owes ₹37,500 — not another half of the original event value.
 *
 * Kept free of Prisma calls and React so the arithmetic can be unit-tested; the
 * server action and the customer screen both read the same functions.
 */

export const PAYMENT_REQUEST_PERCENT: Record<PaymentRequestMode, number> = {
  [PaymentRequestMode.ADVANCE]: 0.25,
  [PaymentRequestMode.HALF]: 0.5,
  [PaymentRequestMode.FULL]: 1,
};

export const PAYMENT_REQUEST_LABEL: Record<PaymentRequestMode, string> = {
  [PaymentRequestMode.ADVANCE]: "Advance (25% of total)",
  [PaymentRequestMode.HALF]: "Half (50% of balance)",
  [PaymentRequestMode.FULL]: "Full balance",
};

/** Money is compared and stored to the paisa, never with float drift. */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * What `paidAmount` should reach for a given mode.
 *
 * `ADVANCE` is always 25% of the booking total, so a second advance does not
 * silently shrink. `HALF` is the one place the live balance matters: it asks
 * for half of what is still owed, expressed as a cumulative target. A booking
 * with ₹75,225 left therefore gets a ₹37,612.50 half-payment request instead of
 * the ₹25,075 that half of the original total would have produced.
 *
 * Clamped to the booking total: a FULL request on a booking whose total has been
 * corrected downwards must not ask for more than the event is worth.
 */
export function paymentRequestTarget(
  mode: PaymentRequestMode,
  totalAmount: number,
  input: { paidAmount?: number; balanceAmount?: number } = {},
): number {
  const total = roundCurrency(Math.max(0, totalAmount));
  if (total <= 0) return 0;

  if (mode === PaymentRequestMode.HALF) {
    const paid = Math.max(0, Number(input.paidAmount) || 0);
    const balance = input.balanceAmount === undefined
      ? Math.max(0, total - paid)
      : Math.max(0, Number(input.balanceAmount) || 0);
    return Math.min(total, roundCurrency(paid + balance * PAYMENT_REQUEST_PERCENT[PaymentRequestMode.HALF]));
  }

  return Math.min(total, roundCurrency(total * PAYMENT_REQUEST_PERCENT[mode]));
}

/**
 * The amount still needed to satisfy an active request, or `null`.
 *
 * `null` means "nothing to show": no request, the target has been met, or the
 * booking is already settled. The value is capped by the live balance so a
 * request can never invite a payment larger than what is owed.
 */
export function paymentRequestOutstanding(input: {
  paymentRequestTargetAmount: unknown;
  paidAmount: unknown;
  balanceAmount: unknown;
}): number | null {
  if (input.paymentRequestTargetAmount === null || input.paymentRequestTargetAmount === undefined) return null;
  const target = Number(input.paymentRequestTargetAmount);
  const paid = Number(input.paidAmount);
  const balance = Number(input.balanceAmount);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(paid) || !Number.isFinite(balance)) return null;

  const due = roundCurrency(Math.min(Math.max(balance, 0), target - paid));
  // Below one paisa there is nothing a checkout could collect.
  return due >= 0.01 ? due : null;
}

/**
 * The amounts the customer may pay right now, in display order.
 *
 * Deliberately narrow: the requested remainder and the full outstanding balance.
 * Allowing any arbitrary figure would let a customer claim they intended a
 * different instalment after the fact, and the team's request is the whole point
 * of the feature. When there is no active request only the full balance remains.
 */
export function paymentAmountOptions(input: {
  paymentRequestTargetAmount: unknown;
  paidAmount: unknown;
  balanceAmount: unknown;
}): { requested: number | null; balance: number; options: number[] } {
  const requested = paymentRequestOutstanding(input);
  const balance = roundCurrency(Math.max(0, Number(input.balanceAmount) || 0));
  const options = requested === null ? [balance] : requested >= balance ? [balance] : [requested, balance];
  return { requested, balance, options: options.filter((amount) => amount >= 0.01) };
}

/** Whether a client-supplied amount is one of the two permitted instalments. */
export function isAllowedPaymentAmount(amount: number, options: number[]): boolean {
  return options.some((option) => Math.abs(option - amount) < 0.01);
}

export type PaymentPreset = {
  key: "ADVANCE" | "HALF" | "FULL";
  label: string;
  amount: number;
  stage: "ADVANCE" | "FINAL";
};

/**
 * The quick-fill amounts shown beside the admin's payment form.
 *
 * A 25% deposit is the common case, but the team also records a half-payment
 * and the final settlement. The 25% and full buttons describe cumulative
 * targets; the half button describes half of the live balance, so a customer
 * who still owes ₹75,225 is asked for ₹37,612.50 rather than ₹25,075.
 */
export function paymentPresets(input: {
  totalAmount: unknown;
  paidAmount: unknown;
  balanceAmount: unknown;
}): PaymentPreset[] {
  const total = roundCurrency(Math.max(0, Number(input.totalAmount) || 0));
  const paid = Math.max(0, Number(input.paidAmount) || 0);
  const balance = roundCurrency(Math.max(0, Number(input.balanceAmount) || 0));
  if (total <= 0 || balance < 0.01) return [];

  const definitions: Array<{ key: PaymentPreset["key"]; label: string; target: number }> = [
    { key: "ADVANCE", label: "25% advance", target: paymentRequestTarget(PaymentRequestMode.ADVANCE, total) },
    {
      key: "HALF",
      label: "50% of balance",
      target: paymentRequestTarget(PaymentRequestMode.HALF, total, { paidAmount: paid, balanceAmount: balance }),
    },
    { key: "FULL", label: "Full balance", target: total },
  ];

  const presets: PaymentPreset[] = [];
  const seen = new Set<number>();
  for (const definition of definitions) {
    const amount = paymentRequestOutstanding({
      paymentRequestTargetAmount: definition.target,
      paidAmount: paid,
      balanceAmount: balance,
    });
    if (amount === null || seen.has(amount)) continue;
    seen.add(amount);
    presets.push({
      key: definition.key,
      label: definition.label,
      amount,
      stage: amount >= balance ? "FINAL" : "ADVANCE",
    });
  }
  return presets;
}

/**
 * The 25% advance button the record-payment form always needs.
 *
 * `paymentPresets` drops the ADVANCE button once the first 25% has been paid,
 * because that cumulative target is already met. That is correct for "reach the
 * 25% target", but it left the admin with only the half and full buttons when
 * taking a second instalment. This preset is deliberately based on the total
 * instead: it offers another 25% payment, capped at the live balance, and
 * becomes a full-settlement button when the balance is smaller than 25%.
 */
export function advancePaymentPreset(input: { totalAmount: unknown; balanceAmount: unknown }): PaymentPreset | null {
  const total = roundCurrency(Math.max(0, Number(input.totalAmount) || 0));
  const balance = roundCurrency(Math.max(0, Number(input.balanceAmount) || 0));
  if (total <= 0 || balance < 0.01) return null;

  const target = paymentRequestTarget(PaymentRequestMode.ADVANCE, total);
  const amount = roundCurrency(Math.min(target, balance));
  if (amount < 0.01) return null;

  return {
    key: "ADVANCE",
    label: amount >= balance ? "Full balance" : "25% advance",
    amount,
    stage: amount >= balance ? "FINAL" : "ADVANCE",
  };
}
