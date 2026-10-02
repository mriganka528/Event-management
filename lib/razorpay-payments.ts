import "server-only";

import { createHash } from "node:crypto";
import { BookingStatus, NotificationAudience, NotificationType, PaymentMethod, PaymentOrderStatus, PaymentProvider, PaymentStage, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/transactions";
import { emitAdminEvent, emitUserEvent } from "@/lib/realtime";
import { emitUserNotification } from "@/lib/notifications";
import { getRazorpayClient, getRazorpayConfig, toPaise, verifyCheckoutSignature } from "@/lib/razorpay-server";

const payableStatuses: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED];

function paymentAmountInPaise(orderAmount: unknown) {
  return toPaise(Number(orderAmount));
}

export async function createRazorpayOrderForBooking(bookingId: string, customerId: string, idempotencyKey: string) {
  const existing = await prisma.paymentOrder.findUnique({ where: { idempotencyKey }, include: { booking: { include: { customer: { include: { user: true } } } } } });
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
    const booking = await tx.booking.findFirst({ where: { id: bookingId, customerId }, include: { customer: { include: { user: true } } } });
    if (!booking) throw new Error("Booking not found.");
    if (!payableStatuses.includes(booking.status)) throw new Error("Online payment is available after the booking is approved.");
    const available = Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount);
    if (available <= 0) throw new Error("This booking has no available balance for payment.");
    const amount = Math.round((available + Number.EPSILON) * 100) / 100;
    const order = await tx.paymentOrder.create({ data: { bookingId, provider: PaymentProvider.RAZORPAY, amount, currency: "INR", idempotencyKey, expiresAt: new Date(Date.now() + 15 * 60 * 1000) }, include: { booking: { include: { customer: { include: { user: true } } } } } });
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
    emitAdminEvent("payment.recorded", { entityId: bookingId, action: "order-failed" });
    throw error;
  }
}

export async function captureRazorpayPayment({ providerOrderId, providerPaymentId, signature, verifySignature = true, verifyProvider = false }: { providerOrderId: string; providerPaymentId: string; signature?: string; verifySignature?: boolean; verifyProvider?: boolean }) {
  if (verifySignature) {
    if (!signature || !verifyCheckoutSignature(providerOrderId, providerPaymentId, signature)) throw new Error("Payment signature verification failed.");
  }

  const orderBefore = await prisma.paymentOrder.findUnique({ where: { providerOrderId }, include: { booking: { include: { customer: { include: { user: true } } } } } });
  if (!orderBefore) throw new Error("Payment order not found.");
  if (orderBefore.status !== PaymentOrderStatus.CREATED) {
    if (orderBefore.status === PaymentOrderStatus.PAID) {
      const paid = await prisma.payment.findFirst({ where: { paymentOrderId: orderBefore.id } });
      if (paid) return { payment: paid, alreadyProcessed: true, customerId: orderBefore.booking.customer.user.id };
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
    if (existing) return { payment: existing, alreadyProcessed: true, customerId: existing.bookingId };

    const order = await tx.paymentOrder.findUnique({ where: { providerOrderId }, include: { booking: { include: { customer: { include: { user: true } }, invoice: true } } } });
    if (!order) throw new Error("Payment order not found.");
    if (order.status !== PaymentOrderStatus.CREATED) {
      const paid = order.status === PaymentOrderStatus.PAID ? await tx.payment.findFirst({ where: { paymentOrderId: order.id } }) : null;
      if (paid) return { payment: paid, alreadyProcessed: true, customerId: order.booking.customer.user.id };
      throw new Error("This payment requires reconciliation.");
    }
    if (!payableStatuses.includes(order.booking.status)) throw new Error("This booking is no longer payable. The payment requires reconciliation.");
    const amount = Number(order.amount);
    if (amount > Number(order.booking.balanceAmount)) throw new Error("The booking balance changed. The payment requires reconciliation.");
    const claimed = await tx.booking.updateMany({ where: { id: order.bookingId, balanceAmount: { gte: amount }, reservedPaymentAmount: { gte: amount }, status: { in: payableStatuses } }, data: { paidAmount: { increment: amount }, balanceAmount: { decrement: amount }, reservedPaymentAmount: { decrement: amount } } });
    if (claimed.count !== 1) throw new Error("The booking balance changed. The payment requires reconciliation.");
    const after = await tx.booking.findUniqueOrThrow({ where: { id: order.bookingId }, select: { paidAmount: true, balanceAmount: true } });
    const payment = await tx.payment.create({ data: { bookingId: order.bookingId, paymentOrderId: order.id, amount, stage: Number(after.balanceAmount) <= 0 ? PaymentStage.FINAL : PaymentStage.ADVANCE, method: PaymentMethod.CARD, provider: PaymentProvider.RAZORPAY, status: PaymentStatus.CAPTURED, providerOrderId, providerPaymentId, providerSignature: signature ?? null, idempotencyKey: `razorpay:${providerPaymentId}`, reference: providerPaymentId } });
    await tx.invoice.upsert({ where: { bookingId: order.bookingId }, update: { paidAmount: after.paidAmount, balanceAmount: after.balanceAmount }, create: { bookingId: order.bookingId, invoiceNumber: `INV-${order.bookingId.slice(0, 8).toUpperCase()}`, taxRate: Number(order.booking.taxAmount) > 0 ? Number(order.booking.taxAmount) / Number(order.booking.subtotal) : 0.18, totalAmount: order.booking.totalAmount, paidAmount: after.paidAmount, balanceAmount: after.balanceAmount } });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: PaymentOrderStatus.PAID, providerPaymentId, providerSignature: signature ?? null, paidAt: new Date() } });
    const paymentNotification = await tx.notification.create({ data: { userId: order.booking.customer.user.id, audience: NotificationAudience.CUSTOMER, type: NotificationType.PAYMENT_RECEIVED, title: "Payment received", message: `We received your online payment of ₹${amount.toLocaleString("en-IN")}.` } });
    return { payment, alreadyProcessed: false, customerId: order.booking.customer.user.id, paymentNotification };
  });

  if (!result.alreadyProcessed) {
    emitAdminEvent("payment.recorded", { entityId: result.payment.bookingId, action: "razorpay" });
    emitUserEvent(result.customerId, "payment.recorded", { entityId: result.payment.bookingId, action: "razorpay" });
    if (result.paymentNotification) emitUserNotification(result.customerId, result.paymentNotification, `/customer/bookings/${result.payment.bookingId}`);
  }
  return result;
}

export async function failRazorpayOrder(providerOrderId: string) {
  await withSerializableRetry(async (tx) => {
    const order = await tx.paymentOrder.findUnique({ where: { providerOrderId } });
    if (!order || order.status !== PaymentOrderStatus.CREATED) return;
    const released = await tx.booking.updateMany({ where: { id: order.bookingId, reservedPaymentAmount: { gte: order.amount } }, data: { reservedPaymentAmount: { decrement: order.amount } } });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: released.count === 1 ? PaymentOrderStatus.FAILED : PaymentOrderStatus.RECONCILIATION_REQUIRED } });
  });
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
