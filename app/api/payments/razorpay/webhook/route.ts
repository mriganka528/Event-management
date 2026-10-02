import { NextResponse } from "next/server";
import { z } from "zod";
import { captureRazorpayPayment, completeWebhookEvent, failRazorpayOrder, recordWebhookEvent } from "@/lib/razorpay-payments";
import { getRazorpayClient, verifyWebhookSignature } from "@/lib/razorpay-server";
import { rateLimitApi, readTextWithLimit, rejectOversizedBody, withNoStore, RequestBodyTooLargeError } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  event: z.string().min(1).max(120),
  payload: z.object({
    payment: z.object({ entity: z.object({ id: z.string().min(1).max(120), order_id: z.string().min(1).max(120) }).partial() }).partial().optional(),
    order: z.object({ entity: z.object({ id: z.string().min(1).max(120) }).partial() }).partial().optional(),
  }).partial().optional(),
}).passthrough();

export async function POST(request: Request) {
  const oversized = rejectOversizedBody(request, 256 * 1024);
  if (oversized) return oversized;
  const limited = rateLimitApi(request, "razorpay-webhook", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  let rawBody: string;
  try {
    rawBody = await readTextWithLimit(request, 256 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return withNoStore(NextResponse.json({ error: "Webhook body is too large." }, { status: 413 }));
    return withNoStore(NextResponse.json({ error: "Invalid webhook body." }, { status: 400 }));
  }
  const signature = request.headers.get("x-razorpay-signature");
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!signature || !eventId || eventId.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(eventId) || signature.length > 512) return withNoStore(NextResponse.json({ error: "Missing webhook signature or event id." }, { status: 400 }));
  if (!verifyWebhookSignature(rawBody, signature)) return withNoStore(NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 }));

  let payload: z.infer<typeof webhookSchema>;
  try {
    const parsed = webhookSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) return withNoStore(NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 }));
    payload = parsed.data;
  } catch {
    return withNoStore(NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 }));
  }

  const eventType = payload.event;
  const payment = payload.payload?.payment?.entity;
  const order = payload.payload?.order?.entity;
  const providerOrderId = payment?.order_id ?? order?.id;
  const providerPaymentId = payment?.id;
  let claim;
  try {
    claim = await recordWebhookEvent({ eventId, eventType, providerOrderId, providerPaymentId, rawBody });
  } catch {
    return withNoStore(NextResponse.json({ error: "Webhook event was already used with different data." }, { status: 409 }));
  }
  if (claim.alreadyProcessed) return withNoStore(NextResponse.json({ received: true, duplicate: true }));

  try {
    let resolvedPaymentId = providerPaymentId;
    if (eventType === "order.paid" && !resolvedPaymentId && providerOrderId) {
      const remoteOrder = await getRazorpayClient().orders.fetch(providerOrderId) as { payments?: Array<{ id?: string }> };
      resolvedPaymentId = remoteOrder.payments?.[0]?.id;
    }
    if ((eventType === "payment.captured" || eventType === "order.paid") && providerOrderId && resolvedPaymentId) {
      await captureRazorpayPayment({ providerOrderId, providerPaymentId: resolvedPaymentId, verifySignature: false, verifyProvider: true });
    } else if (eventType === "payment.captured" || eventType === "order.paid") {
      throw new Error("This payment requires reconciliation.");
    } else if ((eventType === "payment.failed" || eventType === "order.expired") && providerOrderId) {
      await failRazorpayOrder(providerOrderId);
    }
    await completeWebhookEvent(eventId);
    return withNoStore(NextResponse.json({ received: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    if (message.includes("reconciliation")) {
      await completeWebhookEvent(eventId).catch(() => undefined);
      return withNoStore(NextResponse.json({ received: true, status: "reconciliation_required" }));
    }
    await completeWebhookEvent(eventId, message).catch(() => undefined);
    return withNoStore(NextResponse.json({ error: "Webhook processing failed." }, { status: 500 }));
  }
}
