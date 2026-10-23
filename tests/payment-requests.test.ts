import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { PaymentRequestMode } from "@prisma/client";
import {
  advancePaymentPreset,
  PAYMENT_REQUEST_PERCENT,
  isAllowedPaymentAmount,
  paymentAmountOptions,
  paymentPresets,
  paymentRequestOutstanding,
  paymentRequestTarget,
} from "@/lib/payment-requests";

test("an advance is 25% of the total and half is 50% of the remaining balance", () => {
  assert.equal(PAYMENT_REQUEST_PERCENT[PaymentRequestMode.ADVANCE], 0.25);
  assert.equal(PAYMENT_REQUEST_PERCENT[PaymentRequestMode.HALF], 0.5);
  assert.equal(PAYMENT_REQUEST_PERCENT[PaymentRequestMode.FULL], 1);
  assert.equal(paymentRequestTarget(PaymentRequestMode.ADVANCE, 80_000), 20_000);
  assert.equal(paymentRequestTarget(PaymentRequestMode.HALF, 80_000), 40_000);
  assert.equal(
    paymentRequestTarget(PaymentRequestMode.HALF, 80_000, { paidAmount: 10_000, balanceAmount: 70_000 }),
    45_000,
  );
  assert.equal(paymentRequestTarget(PaymentRequestMode.FULL, 80_000), 80_000);
});

test("half of a partly paid booking asks for half the balance, not half the total", () => {
  // The production case: ₹1,00,300 total, ₹25,075 advance already received.
  const total = 100_300;
  const paid = 25_075;
  const balance = 75_225;
  const target = paymentRequestTarget(PaymentRequestMode.HALF, total, { paidAmount: paid, balanceAmount: balance });
  assert.equal(target, 62_687.5);
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: target, paidAmount: paid, balanceAmount: balance }),
    37_612.5,
  );
});

test("the target is capped at the booking total and rounded to paisa", () => {
  assert.equal(paymentRequestTarget(PaymentRequestMode.HALF, 0), 0);
  assert.equal(paymentRequestTarget(PaymentRequestMode.HALF, -10), 0);
  assert.equal(paymentRequestTarget(PaymentRequestMode.ADVANCE, 333.33), 83.33);
});

test("a partial instalment reduces the outstanding request", () => {
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: 40_000, paidAmount: 10_000, balanceAmount: 70_000 }),
    30_000,
  );
});

test("a request can never invite more than the live balance", () => {
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: 80_000, paidAmount: 0, balanceAmount: 25_000 }),
    25_000,
  );
});

test("a met, absent, or settled request shows nothing", () => {
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: null, paidAmount: 0, balanceAmount: 1_000 }),
    null,
  );
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: 40_000, paidAmount: 40_000, balanceAmount: 0 }),
    null,
  );
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: 40_000, paidAmount: 41_000, balanceAmount: 0 }),
    null,
  );
  // A sub-paisa remainder cannot be collected by a checkout.
  assert.equal(
    paymentRequestOutstanding({ paymentRequestTargetAmount: 100, paidAmount: 99.999, balanceAmount: 0.001 }),
    null,
  );
});

test("the customer is offered the requested installment and the full balance", () => {
  const options = paymentAmountOptions({ paymentRequestTargetAmount: 40_000, paidAmount: 0, balanceAmount: 70_000 });
  assert.deepEqual(options, { requested: 40_000, balance: 70_000, options: [40_000, 70_000] });
});

test("without a request, the only checkout figure is the full balance", () => {
  const options = paymentAmountOptions({ paymentRequestTargetAmount: null, paidAmount: 5_000, balanceAmount: 20_000 });
  assert.deepEqual(options, { requested: null, balance: 20_000, options: [20_000] });
});

test("a request equal to the balance is not offered twice", () => {
  const options = paymentAmountOptions({ paymentRequestTargetAmount: 20_000, paidAmount: 0, balanceAmount: 20_000 });
  assert.deepEqual(options.options, [20_000]);
});

test("the server only accepts the figures it actually offered", () => {
  assert.equal(isAllowedPaymentAmount(40_000, [40_000, 70_000]), true);
  assert.equal(isAllowedPaymentAmount(70_000, [40_000, 70_000]), true);
  assert.equal(isAllowedPaymentAmount(50_000, [40_000, 70_000]), false);
  assert.equal(isAllowedPaymentAmount(39_999, [40_000, 70_000]), false);
});

test("admin and customer read the same request arithmetic", () => {
  const admin = readFileSync("components/admin/booking-operations.tsx", "utf8");
  const customer = readFileSync("app/(customer)/customer/bookings/[id]/page.tsx", "utf8");
  for (const source of [admin, customer]) {
    assert.match(source, /paymentRequestOutstanding|paymentAmountOptions/);
  }
  assert.match(admin, /PAYMENT_REQUEST_LABEL/);
});

test("the checkout posts the chosen installment and the API forwards it", () => {
  const checkout = readFileSync("components/payments/razorpay-checkout.tsx", "utf8");
  assert.match(checkout, /body: JSON\.stringify\(\{ bookingId, idempotencyKey, amount: payAmount \}\)/);
  assert.match(checkout, /Pay \$\{currency\.format\(installment\)\} requested/);
  assert.match(checkout, /Pay full balance/);

  const orderRoute = readFileSync("app/api/payments/razorpay/order/route.ts", "utf8");
  assert.match(orderRoute, /requestedAmount/);
  assert.match(orderRoute, /createRazorpayOrderForBooking\(bookingId, user\.customerProfile\.id, idempotencyKey, requestedAmount\)/);

  const payments = readFileSync("lib/razorpay-payments.ts", "utf8");
  assert.match(payments, /isAllowedPaymentAmount\(amount, choices\.options\)/);
});

test("admin quick-fill offers 25%, 50%, and the full balance", () => {
  const presets = paymentPresets({ totalAmount: 80_000, paidAmount: 0, balanceAmount: 80_000 });
  assert.deepEqual(presets.map((preset) => [preset.key, preset.amount]), [
    ["ADVANCE", 20_000],
    ["HALF", 40_000],
    ["FULL", 80_000],
  ]);
  assert.equal(presets[0].stage, "ADVANCE");
  assert.equal(presets[2].stage, "FINAL");
});

test("admin quick-fill asks for the remainder of a target already part-paid", () => {
  const presets = paymentPresets({ totalAmount: 80_000, paidAmount: 10_000, balanceAmount: 70_000 });
  assert.deepEqual(presets.map((preset) => preset.amount), [10_000, 35_000, 70_000]);
});

test("the half quick-fill uses the live balance too", () => {
  const presets = paymentPresets({ totalAmount: 100_300, paidAmount: 25_075, balanceAmount: 75_225 });
  assert.deepEqual(presets.map((preset) => [preset.key, preset.amount]), [
    ["HALF", 37_612.5],
    ["FULL", 75_225],
  ]);
});

test("admin quick-fill never offers more than the available balance", () => {
  const presets = paymentPresets({ totalAmount: 80_000, paidAmount: 10_000, balanceAmount: 5_000 });
  assert.deepEqual(presets.map((preset) => preset.amount), [5_000, 2_500]);
  assert.deepEqual(paymentPresets({ totalAmount: 80_000, paidAmount: 80_000, balanceAmount: 0 }), []);
});

test("record payment keeps a 25% advance after the first advance", () => {
  // The first 25% is already paid, so the cumulative ADVANCE target is met and
  // paymentPresets only returns the remaining half and full options. The
  // record-payment form still needs a one-click second 25% instalment.
  assert.deepEqual(
    advancePaymentPreset({ totalAmount: 80_000, balanceAmount: 60_000 }),
    { key: "ADVANCE", label: "25% advance", amount: 20_000, stage: "ADVANCE" },
  );
  // A balance smaller than 25% settles the booking, so the button becomes the
  // full-balance shortcut and is staged as final.
  assert.deepEqual(
    advancePaymentPreset({ totalAmount: 80_000, balanceAmount: 10_000 }),
    { key: "ADVANCE", label: "Full balance", amount: 10_000, stage: "FINAL" },
  );
  assert.equal(advancePaymentPreset({ totalAmount: 80_000, balanceAmount: 0 }), null);

  // Both admin payment surfaces must use the extra preset, or the button only
  // appears on one of them.
  const operations = readFileSync("components/admin/booking-operations.tsx", "utf8");
  const manual = readFileSync("components/admin/manual-payment-form.tsx", "utf8");
  for (const source of [operations, manual]) {
    assert.match(source, /advancePaymentPreset/);
    assert.match(source, /Advance \/ part payment/);
    assert.match(source, /Final settlement/);
  }
});

test("cash declarations stay pending until an admin approves them", () => {
  const cash = readFileSync("lib/cash-payments.ts", "utf8");
  assert.match(cash, /status: PaymentStatus\.PENDING/);
  assert.match(cash, /method: PaymentMethod\.CASH/);
  assert.match(cash, /provider: PaymentProvider\.MANUAL/);
  assert.match(cash, /export async function approveCashPayment/);
  assert.match(cash, /data: \{ status: PaymentStatus\.CAPTURED, paidAt: new Date\(\) \}/);
  assert.match(cash, /paidAmount: \{ increment: amount \}, balanceAmount: \{ decrement: amount \}/);
  assert.match(cash, /export async function failPendingCashClaims/);

  const ledger = readFileSync("lib/admin-data.ts", "utf8");
  assert.match(ledger, /where: \{ status: "CAPTURED" \}/);
  assert.match(ledger, /where: \{ status: "PENDING", method: "CASH" \}/);

  const invoices = readFileSync("lib/invoices.ts", "utf8");
  assert.match(invoices, /where: \{ status: PaymentStatus\.CAPTURED \}/);
});

test("the customer can declare cash and the admin can approve or reject it", () => {
  const checkout = readFileSync("components/payments/razorpay-checkout.tsx", "utf8");
  assert.match(checkout, /declareCashPaymentFormAction/);
  assert.match(checkout, /I paid .* in cash/);
  assert.match(checkout, /pendingCashAmount/);

  const approvals = readFileSync("components/admin/pending-cash-approvals.tsx", "utf8");
  assert.match(approvals, /approveCashPaymentFormAction/);
  assert.match(approvals, /rejectCashPaymentFormAction/);

  const actions = readFileSync("lib/actions.ts", "utf8");
  assert.match(actions, /export async function declareCashPaymentAction/);
  assert.match(actions, /export async function approveCashPaymentAction/);
  assert.match(actions, /export async function rejectCashPaymentAction/);
});

test("a successful Razorpay capture still writes a captured payment", () => {
  const payments = readFileSync("lib/razorpay-payments.ts", "utf8");
  assert.match(payments, /const payment = await tx\.payment\.create/);
  assert.match(payments, /status: PaymentStatus\.CAPTURED/);
  assert.match(payments, /await tx\.invoice\.upsert/);
  assert.match(payments, /await failPendingCashClaims\(tx, order\.bookingId\)/);
});

test("approval is required before a request can be sent", () => {
  const actions = readFileSync("lib/actions.ts", "utf8");
  assert.match(actions, /export async function requestPaymentAction/);
  assert.match(actions, /Payment can only be requested after the booking is approved/);
  assert.match(actions, /paymentRequestMode: mode, paymentRequestTargetAmount: target/);
  assert.match(actions, /NotificationType\.PAYMENT_REQUESTED/);
});
