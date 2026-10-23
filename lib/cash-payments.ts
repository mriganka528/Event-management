import "server-only";
import {
  BookingStatus,
  NotificationType,
  PaymentMethod,
  PaymentProvider,
  PaymentStage,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_USER_FIELDS } from "@/lib/user-fields";
import { emitAdminEvent, emitUserEvent } from "@/lib/realtime";
import { notifyAdmins, notifyUser } from "@/lib/notifications";
import { isAllowedPaymentAmount, paymentAmountOptions, roundCurrency } from "@/lib/payment-requests";
import { withSerializableRetry } from "@/lib/transactions";
import { sendPaymentReceivedEmail } from "@/lib/mailer";
import { absoluteUrl } from "@/lib/site";

const payableStatuses: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED];

function cashStage(amount: number, balance: number): PaymentStage {
  return amount >= balance - 0.01 ? PaymentStage.FINAL : PaymentStage.ADVANCE;
}

/** A notification outage must not make a recorded cash movement look failed. */
async function bestEffortNotification(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    console.error("Cash payment notification failed.", error);
  }
}

/**
 * A customer says they handed over cash. Nothing is credited yet: the row is a
 * claim (`PENDING`, `CASH`, `MANUAL`) that an administrator must approve. The
 * booking balance, invoice, and captured-payment history stay untouched until
 * that approval, so a false claim cannot make a booking look paid.
 */
export async function declareCashPayment(input: {
  bookingId: string;
  customerId: string;
  amount: number;
}) {
  const amount = roundCurrency(input.amount);
  if (!Number.isFinite(amount) || amount < 0.01) throw new Error("Enter a cash amount of at least ₹0.01.");

  const result = await withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, customerId: input.customerId },
      include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } },
    });
    if (!booking) throw new Error("You cannot declare a payment for this booking.");
    if (!payableStatuses.includes(booking.status)) throw new Error("Cash payments can be declared after the booking is approved.");
    if (Number(booking.balanceAmount) < 0.01) throw new Error("This booking is already fully paid.");
    const available = roundCurrency(Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount));
    if (available < 0.01) throw new Error("An online payment for this booking is already being processed. Finish it, or wait for it to expire.");

    const options = paymentAmountOptions({
      paymentRequestTargetAmount: booking.paymentRequestTargetAmount,
      paidAmount: booking.paidAmount,
      balanceAmount: available,
    });
    if (!isAllowedPaymentAmount(amount, options.options)) {
      throw new Error("Choose one of the payment amounts shown for this booking.");
    }

    const existing = await tx.payment.findFirst({
      where: { bookingId: booking.id, method: PaymentMethod.CASH, status: PaymentStatus.PENDING },
      select: { id: true, amount: true },
    });
    if (existing) {
      throw new Error(`A cash payment of ₹${Number(existing.amount).toLocaleString("en-IN")} is already waiting for approval.`);
    }

    const claim = await tx.payment.create({
      data: {
        bookingId: booking.id,
        amount,
        stage: cashStage(amount, Number(booking.balanceAmount)),
        method: PaymentMethod.CASH,
        provider: PaymentProvider.MANUAL,
        status: PaymentStatus.PENDING,
      },
    });
    return { claim, customer: booking.customer, booking };
  });

  await bestEffortNotification(() => notifyAdmins({
    type: NotificationType.PAYMENT_REQUESTED,
    title: "Cash payment awaiting approval",
    message: `${result.booking.customer.user.firstName} ${result.booking.customer.user.lastName ?? ""}`.trim()
      + ` declared a cash payment of ₹${amount.toLocaleString("en-IN")} for booking ${result.booking.id.slice(0, 8).toUpperCase()}. Approve it once you have received the cash.`,
    href: "/admin/payments",
  }));

  return result.claim;
}

/**
 * Approve a pending cash claim. Re-checking the live balance here is what makes
 * the ledger safe when an online payment lands while the claim is waiting: the
 * booking can no longer be credited twice.
 */
export async function approveCashPayment(paymentId: string) {
  const result = await withSerializableRetry(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } } },
    });
    if (!payment) throw new Error("Cash payment not found.");
    if (payment.method !== PaymentMethod.CASH || payment.provider !== PaymentProvider.MANUAL || payment.status !== PaymentStatus.PENDING) {
      throw new Error("This cash payment is no longer waiting for approval.");
    }

    const booking = payment.booking;
    if (!payableStatuses.includes(booking.status)) throw new Error("Payments can only be approved on active bookings.");
    const amount = Number(payment.amount);
    const available = Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount);
    if (amount <= 0) throw new Error("The cash amount is invalid.");
    if (amount > available + 0.009) throw new Error("The cash amount is greater than the current outstanding balance. Reject it and ask the customer to declare the correct amount.");

    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING, method: PaymentMethod.CASH },
      data: { status: PaymentStatus.CAPTURED, paidAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("This cash payment was already reviewed. Refresh and try again.");

    const updatedBooking = await tx.booking.updateMany({
      where: { id: booking.id, status: { in: payableStatuses }, balanceAmount: { gte: amount } },
      data: { paidAmount: { increment: amount }, balanceAmount: { decrement: amount } },
    });
    if (updatedBooking.count !== 1) throw new Error("The booking balance changed. Refresh and try again.");

    const after = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { paidAmount: true, balanceAmount: true } });
    await tx.invoice.upsert({
      where: { bookingId: booking.id },
      update: { paidAmount: after.paidAmount, balanceAmount: after.balanceAmount },
      create: {
        bookingId: booking.id,
        invoiceNumber: `INV-${booking.id.slice(0, 8).toUpperCase()}`,
        taxRate: Number(booking.subtotal) > 0 ? Number(booking.taxAmount) / Number(booking.subtotal) : 0.18,
        totalAmount: booking.totalAmount,
        paidAmount: after.paidAmount,
        balanceAmount: after.balanceAmount,
      },
    });

    return {
      paymentId: payment.id,
      bookingId: booking.id,
      customerId: booking.customer.user.id,
      amount,
      customerEmail: booking.customer.user.email,
      customerFirstName: booking.customer.user.firstName,
      customerName: [booking.customer.user.firstName, booking.customer.user.lastName].filter(Boolean).join(" "),
      balanceAmount: Number(after.balanceAmount),
    };
  });

  emitAdminEvent("payment.recorded", { entityId: result.bookingId, action: "cash-approved" });
  emitUserEvent(result.customerId, "payment.recorded", { entityId: result.bookingId, action: "cash-approved" });
  await bestEffortNotification(() => notifyAdmins({
    type: NotificationType.PAYMENT_RECEIVED,
    title: "Cash payment approved",
    message: `${result.customerName || "A customer"}'s cash payment of ₹${result.amount.toLocaleString("en-IN")} was approved for booking ${result.bookingId.slice(0, 8).toUpperCase()}. Remaining balance ₹${result.balanceAmount.toLocaleString("en-IN")}.`,
    href: `/admin/bookings/${result.bookingId}`,
  }));
  await bestEffortNotification(() => notifyUser(result.customerId, {
    type: NotificationType.PAYMENT_RECEIVED,
    title: "Cash payment approved",
    message: `Our team confirmed your cash payment of ₹${result.amount.toLocaleString("en-IN")}. Your balance has been updated.`,
    href: `/customer/bookings/${result.bookingId}`,
  }));
  await bestEffortNotification(() => sendPaymentReceivedEmail({
    to: result.customerEmail,
    firstName: result.customerFirstName,
    reference: result.bookingId.slice(0, 8).toUpperCase(),
    amount: result.amount,
    balanceAmount: result.balanceAmount,
    bookingUrl: absoluteUrl(`/customer/bookings/${result.bookingId}`),
  }));
  return { paymentId: result.paymentId, bookingId: result.bookingId };
}

export async function rejectCashPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } } },
  });
  if (!payment) throw new Error("Cash payment not found.");
  if (payment.method !== PaymentMethod.CASH || payment.status !== PaymentStatus.PENDING) {
    throw new Error("This cash payment is no longer waiting for approval.");
  }

  const rejected = await prisma.payment.updateMany({
    where: { id: payment.id, status: PaymentStatus.PENDING, method: PaymentMethod.CASH },
    data: { status: PaymentStatus.FAILED },
  });
  if (rejected.count !== 1) throw new Error("This cash payment was already reviewed. Refresh and try again.");

  const customerName = [payment.booking.customer.user.firstName, payment.booking.customer.user.lastName].filter(Boolean).join(" ");
  await bestEffortNotification(() => notifyAdmins({
    type: NotificationType.PAYMENT_REQUESTED,
    title: "Cash payment declined",
    message: `${customerName || "A customer"}'s cash payment of ₹${Number(payment.amount).toLocaleString("en-IN")} for booking ${payment.bookingId.slice(0, 8).toUpperCase()} was not approved. The booking balance is unchanged.`,
    href: `/admin/bookings/${payment.bookingId}`,
  }));
  await bestEffortNotification(() => notifyUser(payment.booking.customer.user.id, {
    type: NotificationType.PAYMENT_REQUESTED,
    title: "Cash payment not approved",
    message: `We could not confirm the cash payment of ₹${Number(payment.amount).toLocaleString("en-IN")} for your booking. Please contact the team or choose another payment method.`,
    href: `/customer/bookings/${payment.bookingId}`,
  }));
  emitAdminEvent("payment.recorded", { entityId: payment.bookingId, action: "cash-rejected" });
  emitUserEvent(payment.booking.customer.user.id, "payment.recorded", { entityId: payment.bookingId, action: "cash-rejected" });
  return { paymentId: payment.id, bookingId: payment.bookingId };
}

/**
 * Any captured payment — online or recorded by the team — supersedes an open
 * cash claim for the same booking. Keeping the claim pending would invite the
 * admin to approve a second payment for money that is already settled.
 */
export async function failPendingCashClaims(client: Prisma.TransactionClient, bookingId: string) {
  await client.payment.updateMany({
    where: { bookingId, method: PaymentMethod.CASH, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.FAILED },
  });
}