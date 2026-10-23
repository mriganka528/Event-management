import "server-only";

import { createHash } from "node:crypto";
import { BookingStatus, NotificationAudience, NotificationType, PaymentMethod, PaymentOrderStatus, PaymentProvider, PaymentStage, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_USER_FIELDS } from "@/lib/user-fields";
import { withSerializableRetry } from "@/lib/transactions";
import { emitAdminEvent, emitUserEvent } from "@/lib/realtime";
import { emitUserNotification, notifyAdminsSafely } from "@/lib/notifications";
import { failPendingCashClaims } from "@/lib/cash-payments";
import { isAllowedPaymentAmount, paymentAmountOptions } from "@/lib/payment-requests";
import { getRazorpayClient, getRazorpayConfig, toPaise, verifyCheckoutSignature } from "@/lib/razorpay-server";
import { sendPaymentReceivedEmail } from "@/lib/mailer";
import { absoluteUrl } from "@/lib/site";

const payableStatuses: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED];

/**
 * The payment method the provider recorded, mapped onto ours.
 *
 * Razorpay reports the instrument it was paid with, and recording it means the
 * invoice and the payment history say how the money arrived rather than always
 * claiming a card. An unrecognised method falls back to a card, which is what
 * the provider means by "the payment was made".
 */
export function paymentMethodFromProvider(method: string | null | undefined): PaymentMethod {
  switch ((method ?? "").toLowerCase()) {
    case "upi":
      return PaymentMethod.UPI;
    case "netbanking":
      return PaymentMethod.NETBANKING;
    case "card":
    default:
      return PaymentMethod.CARD;
  }
}

function paymentMethodLabel(method: PaymentMethod) {
  switch (method) {
    case PaymentMethod.UPI:
      return "UPI";
    case PaymentMethod.NETBANKING:
      return "net banking";
    case PaymentMethod.CARD:
      return "card";
    case PaymentMethod.CASH:
      return "cash";
    default:
      return "online";
  }
}

function paymentAmountInPaise(orderAmount: unknown) {
  return toPaise(Number(orderAmount));
}

export async function createRazorpayOrderForBooking(bookingId: string, customerId: string, idempotencyKey: string, requestedAmount?: number) {
  const existing = await prisma.paymentOrder.findUnique({ where: { idempotencyKey }, include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } } } });
  if (existing) {
    if (existing.booking.customerId !== customerId || existing.bookingId !== bookingId) throw new Error("That payment attempt belongs to another booking.");
    if (existing.status === PaymentOrderStatus.PAID) throw new Error("This payment has already been completed.");
    if (existing.status !== PaymentOrderStatus.CREATED) throw new Error("This payment attempt is no longer open. Start a new checkout.");
    if (!existing.providerOrderId) throw new Error("This payment attempt is still being prepared. Try again in a moment.");
    return {
      providerOrderId: existing.providerOrderId,
      amount: Number(existing.amount),
      amountPaise: paymentAmountInPaise(existing.amount),
      currency: existing.currency,
      keyId: getRazorpayConfig().keyId,
      prefill: { name: `${existing.booking.customer.user.firstName} ${existing.booking.customer.user.lastName ?? ""}`.trim(), email: existing.booking.customer.user.email, phone: existing.booking.customer.user.phone ?? undefined },
    };
  }

  const local = await withSerializableRetry(async (tx) => {
    const staleOrders = await tx.paymentOrder.findMany({ where: { bookingId, status: PaymentOrderStatus.CREATED, expiresAt: { lte: new Date() } }, select: { id: true, amount: true } });
    for (const staleOrder of staleOrders) {
      await tx.booking.updateMany({ where: { id: bookingId, reservedPaymentAmount: { gte: staleOrder.amount } }, data: { reservedPaymentAmount: { decrement: staleOrder.amount } } });
      await tx.paymentOrder.update({ where: { id: staleOrder.id }, data: { status: PaymentOrderStatus.EXPIRED } });
    }
    const booking = await tx.booking.findFirst({ where: { id: bookingId, customerId }, include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } });
    if (!booking) throw new Error("Booking not found.");
    if (!payableStatuses.includes(booking.status)) throw new Error("Online payment is available after the booking is approved.");
    const available = Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount);
    if (available <= 0) throw new Error("This booking has no available balance for payment.");
    /*
     * The amount is the whole balance unless the caller asked for an
     * instalment, and the server decides whether the request is legal.
     *
     * The permitted figures are the same ones the customer was offered, so a
     * hand-crafted request cannot ask for a different amount after the fact
     * and then claim the team agreed to it.
     */
    const choices = paymentAmountOptions({
      paymentRequestTargetAmount: booking.paymentRequestTargetAmount,
      paidAmount: booking.paidAmount,
      balanceAmount: booking.balanceAmount,
    });
    const amount = typeof requestedAmount === "number" && Number.isFinite(requestedAmount) ? Math.round((requestedAmount + Number.EPSILON) * 100) / 100 : Math.round((available + Number.EPSILON) * 100) / 100;
    if (!isAllowedPaymentAmount(amount, choices.options)) {
      throw new Error("That payment amount is not available. Choose the requested installment or the full balance.");
    }
    const order = await tx.paymentOrder.create({ data: { bookingId, provider: PaymentProvider.RAZORPAY, amount, currency: "INR", idempotencyKey, expiresAt: new Date(Date.now() + 15 * 60 * 1000) }, include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } } } });
    const claimed = await tx.booking.updateMany({ where: { id: bookingId, balanceAmount: booking.balanceAmount, reservedPaymentAmount: booking.reservedPaymentAmount }, data: { reservedPaymentAmount: { increment: amount } } });
    if (claimed.count !== 1) throw new Error("The booking balance changed. Please retry.");
    return order;
  });

  try {
    const providerOrder = await getRazorpayClient().orders.create({ amount: paymentAmountInPaise(local.amount), currency: local.currency, receipt: local.id, notes: { bookingId, paymentOrderId: local.id, expiresAt: local.expiresAt.toISOString() } });
    const providerOrderId = providerOrder.id;
    if (!providerOrderId) throw new Error("Razorpay did not return an order id.");
    await prisma.paymentOrder.update({ where: { id: local.id }, data: { providerOrderId } });
    emitAdminEvent("payment.recorded", { entityId: local.bookingId, action: "order-created" });
    return { providerOrderId, amount: Number(local.amount), amountPaise: paymentAmountInPaise(local.amount), currency: local.currency, keyId: getRazorpayConfig().keyId, prefill: { name: `${local.booking.customer.user.firstName} ${local.booking.customer.user.lastName ?? ""}`.trim(), email: local.booking.customer.user.email, phone: local.booking.customer.user.phone ?? undefined } };
  } catch (error) {
    await withSerializableRetry(async (tx) => {
      const order = await tx.paymentOrder.findUnique({ where: { id: local.id } });
      if (!order || order.status !== PaymentOrderStatus.CREATED) return;
      await tx.booking.updateMany({ where: { id: bookingId, reservedPaymentAmount: { gte: order.amount } }, data: { reservedPaymentAmount: { decrement: order.amount } } });
      await tx.paymentOrder.update({ where: { id: order.id }, data: { status: PaymentOrderStatus.FAILED } });
    }).catch(() => undefined);
    await notifyAdminsSafely({
      type: NotificationType.PAYMENT_REQUESTED,
      title: "Online checkout could not start",
      message: `${[local.booking.customer.user.firstName, local.booking.customer.user.lastName].filter(Boolean).join(" ") || "A customer"}'s online payment of ₹${Number(local.amount).toLocaleString("en-IN")} for booking ${bookingId.slice(0, 8).toUpperCase()} could not be started. The booking balance is unchanged.`,
      href: `/admin/bookings/${bookingId}`,
    });
    emitAdminEvent("payment.recorded", { entityId: bookingId, action: "order-failed" });
    throw error;
  }
}

export async function captureRazorpayPayment({ providerOrderId, providerPaymentId, signature, method, verifySignature = true, verifyProvider = false }: { providerOrderId: string; providerPaymentId: string; signature?: string; method?: PaymentMethod; verifySignature?: boolean; verifyProvider?: boolean }) {
  if (verifySignature) {
    if (!signature || !verifyCheckoutSignature(providerOrderId, providerPaymentId, signature)) throw new Error("Payment signature verification failed.");
  }

  const orderBefore = await prisma.paymentOrder.findUnique({ where: { providerOrderId }, include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } } } });
  if (!orderBefore) throw new Error("Payment order not found.");
  if (orderBefore.status !== PaymentOrderStatus.CREATED) {
    if (orderBefore.status === PaymentOrderStatus.PAID) {
      const paid = await prisma.payment.findFirst({ where: { paymentOrderId: orderBefore.id } });
      if (paid) return { payment: paid, alreadyProcessed: true, customerId: orderBefore.booking.customer.user.id, customerEmail: null, customerFirstName: null, balanceAmount: null };
    }
    await prisma.paymentOrder.updateMany({ where: { id: orderBefore.id, status: { not: PaymentOrderStatus.PAID } }, data: { status: PaymentOrderStatus.RECONCILIATION_REQUIRED } });
    throw new Error("This payment requires reconciliation.");
  }
  if (verifyProvider) {
    const providerPayment = await getRazorpayClient().payments.fetch(providerPaymentId) as { order_id?: string; amount?: number; currency?: string; status?: string };
    if (providerPayment.order_id !== providerOrderId || providerPayment.status !== "captured" || providerPayment.amount !== Math.round(Number(orderBefore.amount) * 100) || providerPayment.currency !== orderBefore.currency) throw new Error("Razorpay payment details did not match the order.");
  }
  const result = await withSerializableRetry(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { providerPaymentId } });
    if (existing) return { payment: existing, alreadyProcessed: true, customerId: existing.bookingId, customerEmail: null, customerFirstName: null, balanceAmount: null };

    const order = await tx.paymentOrder.findUnique({ where: { providerOrderId }, include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } }, invoice: true } } } });
    if (!order) throw new Error("Payment order not found.");
    if (order.status !== PaymentOrderStatus.CREATED) {
      const paid = order.status === PaymentOrderStatus.PAID ? await tx.payment.findFirst({ where: { paymentOrderId: order.id } }) : null;
      if (paid) return { payment: paid, alreadyProcessed: true, customerId: order.booking.customer.user.id, customerEmail: null, customerFirstName: null, balanceAmount: null };
      throw new Error("This payment requires reconciliation.");
    }
    if (!payableStatuses.includes(order.booking.status)) throw new Error("This booking is no longer payable. The payment requires reconciliation.");
    const amount = Number(order.amount);
    if (amount > Number(order.booking.balanceAmount)) throw new Error("The booking balance changed. The payment requires reconciliation.");
    const claimed = await tx.booking.updateMany({ where: { id: order.bookingId, balanceAmount: { gte: amount }, reservedPaymentAmount: { gte: amount }, status: { in: payableStatuses } }, data: { paidAmount: { increment: amount }, balanceAmount: { decrement: amount }, reservedPaymentAmount: { decrement: amount } } });
    if (claimed.count !== 1) throw new Error("The booking balance changed. The payment requires reconciliation.");
    const after = await tx.booking.findUniqueOrThrow({ where: { id: order.bookingId }, select: { paidAmount: true, balanceAmount: true } });
    // A recorded payment settles the booking, so an older unpaid cash claim
    // can no longer be approved against the same money.
    await failPendingCashClaims(tx, order.bookingId);
    const payment = await tx.payment.create({ data: { bookingId: order.bookingId, paymentOrderId: order.id, amount, stage: Number(after.balanceAmount) <= 0 ? PaymentStage.FINAL : PaymentStage.ADVANCE, method: method ?? PaymentMethod.CARD, provider: PaymentProvider.RAZORPAY, status: PaymentStatus.CAPTURED, providerOrderId, providerPaymentId, providerSignature: signature ?? null, idempotencyKey: `razorpay:${providerPaymentId}`, reference: providerPaymentId } });
    await tx.invoice.upsert({ where: { bookingId: order.bookingId }, update: { paidAmount: after.paidAmount, balanceAmount: after.balanceAmount }, create: { bookingId: order.bookingId, invoiceNumber: `INV-${order.bookingId.slice(0, 8).toUpperCase()}`, taxRate: Number(order.booking.taxAmount) > 0 ? Number(order.booking.taxAmount) / Number(order.booking.subtotal) : 0.18, totalAmount: order.booking.totalAmount, paidAmount: after.paidAmount, balanceAmount: after.balanceAmount } });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: PaymentOrderStatus.PAID, providerPaymentId, providerSignature: signature ?? null, paidAt: new Date() } });
    const paymentNotification = await tx.notification.create({ data: { userId: order.booking.customer.user.id, audience: NotificationAudience.CUSTOMER, type: NotificationType.PAYMENT_RECEIVED, title: "Payment received", message: `We received your online payment of ₹${amount.toLocaleString("en-IN")}.`, href: `/customer/bookings/${order.bookingId}` } });
    return { payment, alreadyProcessed: false, customerId: order.booking.customer.user.id, paymentNotification, customerEmail: order.booking.customer.user.email, customerFirstName: order.booking.customer.user.firstName, balanceAmount: Number(after.balanceAmount) };
  });

  if (!result.alreadyProcessed) {
    emitAdminEvent("payment.recorded", { entityId: result.payment.bookingId, action: "razorpay" });
    emitUserEvent(result.customerId, "payment.recorded", { entityId: result.payment.bookingId, action: "razorpay" });
    await notifyAdminsSafely({
      type: NotificationType.PAYMENT_RECEIVED,
      title: "Online payment received",
      message: `${result.customerFirstName || "A customer"} paid ₹${Number(result.payment.amount).toLocaleString("en-IN")} by ${paymentMethodLabel(result.payment.method)} for booking ${result.payment.bookingId.slice(0, 8).toUpperCase()}. Remaining balance ₹${(result.balanceAmount ?? 0).toLocaleString("en-IN")}.`,
      href: `/admin/bookings/${result.payment.bookingId}`,
    });
    if (result.paymentNotification) emitUserNotification(result.customerId, result.paymentNotification, `/customer/bookings/${result.payment.bookingId}`);
    if (result.customerEmail) {
      await sendPaymentReceivedEmail({
        to: result.customerEmail,
        firstName: result.customerFirstName ?? "",
        reference: result.payment.bookingId.slice(0, 8).toUpperCase(),
        amount: Number(result.payment.amount),
        balanceAmount: result.balanceAmount ?? 0,
        bookingUrl: absoluteUrl(`/customer/bookings/${result.payment.bookingId}`),
      });
    }
  }
  return result;
}

export async function failRazorpayOrder(providerOrderId: string) {
  const failed = await withSerializableRetry(async (tx) => {
    const order = await tx.paymentOrder.findUnique({
      where: { providerOrderId },
      include: { booking: { include: { customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } } } } },
    });
    if (!order || order.status !== PaymentOrderStatus.CREATED) return null;
    const released = await tx.booking.updateMany({ where: { id: order.bookingId, reservedPaymentAmount: { gte: order.amount } }, data: { reservedPaymentAmount: { decrement: order.amount } } });
    const status = released.count === 1 ? PaymentOrderStatus.FAILED : PaymentOrderStatus.RECONCILIATION_REQUIRED;
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status } });
    return {
      status,
      amount: Number(order.amount),
      bookingId: order.bookingId,
      customerName: [order.booking.customer.user.firstName, order.booking.customer.user.lastName].filter(Boolean).join(" "),
    };
  });

  if (failed) {
    const needsReview = failed.status === PaymentOrderStatus.RECONCILIATION_REQUIRED;
    await notifyAdminsSafely({
      type: NotificationType.PAYMENT_REQUESTED,
      title: needsReview ? "Online payment needs review" : "Online payment failed",
      message: needsReview
        ? `${failed.customerName || "A customer"}'s online payment of ₹${failed.amount.toLocaleString("en-IN")} for booking ${failed.bookingId.slice(0, 8).toUpperCase()} could not release its reserved balance safely. Review the booking before taking another payment.`
        : `${failed.customerName || "A customer"}'s online payment of ₹${failed.amount.toLocaleString("en-IN")} for booking ${failed.bookingId.slice(0, 8).toUpperCase()} failed or was cancelled. The booking balance is unchanged.`,
      href: `/admin/bookings/${failed.bookingId}`,
    });
  }
}

export async function recordWebhookEvent({ eventId, eventType, providerOrderId, providerPaymentId, rawBody }: { eventId: string; eventType: string; providerOrderId?: string; providerPaymentId?: string; rawBody: string }) {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const existing = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: eventId } });
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new Error("Webhook event id was reused with a different payload.");
    if (existing.status === "PROCESSED") return { event: existing, alreadyProcessed: true };
    return { event: await prisma.paymentWebhookEvent.update({ where: { providerEventId: eventId }, data: { status: "PROCESSING", error: null } }), alreadyProcessed: false };
  }
  try {
    return { event: await prisma.paymentWebhookEvent.create({ data: { providerEventId: eventId, eventType, providerOrderId, providerPaymentId, payloadHash, status: "PROCESSING" } }), alreadyProcessed: false };
  } catch {
    const raced = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: eventId } });
    if (!raced || raced.payloadHash !== payloadHash) throw new Error("Webhook event could not be claimed safely.");
    return { event: raced, alreadyProcessed: raced.status === "PROCESSED" };
  }
}

export async function completeWebhookEvent(eventId: string, error?: string) {
  return prisma.paymentWebhookEvent.update({ where: { providerEventId: eventId }, data: { status: error ? "FAILED" : "PROCESSED", error: error ?? null, processedAt: new Date() } });
}
