import { NextResponse } from "next/server";
import { requireApiCustomer } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { prisma } from "@/lib/prisma";
import { captureRazorpayPayment } from "@/lib/razorpay-payments";
import { getRazorpayClient, verifyCheckoutSignature } from "@/lib/razorpay-server";
import { rateLimitApi, readJsonBody, rejectCrossSiteMutation, rejectOversizedBody, requireJsonContentType, withNoStore, InvalidJsonError, RequestBodyTooLargeError } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 16 * 1024);
  if (oversized) return oversized;
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;

  let user: Awaited<ReturnType<typeof requireApiCustomer>>;
  try {
    user = await requireApiCustomer();
  } catch (error) {
    if (error instanceof AuthError) {
      return withNoStore(NextResponse.json({ error: error.code === "UNAUTHENTICATED" ? "Please sign in to verify payment." : "Only approved customer accounts can use online checkout." }, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 }));
    }
    throw error;
  }
  if (!user.customerProfile) return withNoStore(NextResponse.json({ error: "Only customer accounts can use online checkout." }, { status: 403 }));
  const limited = rateLimitApi(request, "razorpay-verify", { limit: 20, windowMs: 10 * 60_000, keySuffix: user.id });
  if (limited) return limited;

  try {
    const body = (await readJsonBody(request, 16 * 1024)) as { razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown };
    const providerOrderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
    const providerPaymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature.trim() : "";
    if (!providerOrderId || !providerPaymentId || !signature || providerOrderId.length > 100 || providerPaymentId.length > 100 || signature.length > 256) return withNoStore(NextResponse.json({ error: "Payment callback is incomplete." }, { status: 400 }));
    if (!verifyCheckoutSignature(providerOrderId, providerPaymentId, signature)) return withNoStore(NextResponse.json({ error: "Payment signature verification failed." }, { status: 400 }));

    const localOrder = await prisma.paymentOrder.findUnique({ where: { providerOrderId }, include: { booking: { select: { customerId: true, totalAmount: true, balanceAmount: true } } } });
    if (!localOrder || localOrder.booking.customerId !== user.customerProfile.id) return withNoStore(NextResponse.json({ error: "Payment order not found." }, { status: 404 }));

    const providerPayment = await getRazorpayClient().payments.fetch(providerPaymentId) as { id?: string; order_id?: string; amount?: number; currency?: string; status?: string };
    if (providerPayment.order_id !== providerOrderId || providerPayment.status !== "captured" || providerPayment.amount !== Math.round(Number(localOrder.amount) * 100) || providerPayment.currency !== localOrder.currency) return withNoStore(NextResponse.json({ error: "Razorpay has not confirmed this payment yet." }, { status: 409 }));

    const result = await captureRazorpayPayment({ providerOrderId, providerPaymentId, signature });
    return withNoStore(NextResponse.json({ status: "paid", alreadyProcessed: result.alreadyProcessed }));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return withNoStore(NextResponse.json({ error: "Request body is too large." }, { status: 413 }));
    if (error instanceof InvalidJsonError) return withNoStore(NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }));
    const message = error instanceof Error ? error.message : "Unable to verify payment.";
    return withNoStore(NextResponse.json({ error: message.includes("signature") ? message : "Payment verification is still processing." }, { status: message.includes("signature") ? 400 : 409 }));
  }
}
