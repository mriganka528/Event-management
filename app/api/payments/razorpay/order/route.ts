import { NextResponse } from "next/server";
import { requireApiCustomer } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { createRazorpayOrderForBooking } from "@/lib/razorpay-payments";
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

  // `requireApiCustomer` enforces identity + approval + MFA + customer role.
  let user: Awaited<ReturnType<typeof requireApiCustomer>>;
  try {
    user = await requireApiCustomer();
  } catch (error) {
    if (error instanceof AuthError) {
      return withNoStore(NextResponse.json({ error: error.code === "UNAUTHENTICATED" ? "Please sign in to pay online." : "Only approved customer accounts can use online checkout." }, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 }));
    }
    throw error;
  }
  if (!user.customerProfile) return withNoStore(NextResponse.json({ error: "Only customer accounts can use online checkout." }, { status: 403 }));
  const limited = rateLimitApi(request, "razorpay-order", { limit: 10, windowMs: 10 * 60_000, keySuffix: user.id });
  if (limited) return limited;

  try {
    const body = (await readJsonBody(request, 16 * 1024)) as { bookingId?: unknown; idempotencyKey?: unknown };
    const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : request.headers.get("idempotency-key")?.trim() ?? "";
    if (!bookingId || bookingId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(bookingId) || idempotencyKey.length < 8 || idempotencyKey.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) return withNoStore(NextResponse.json({ error: "A valid booking and idempotency key are required." }, { status: 400 }));
    const order = await createRazorpayOrderForBooking(bookingId, user.customerProfile.id, idempotencyKey);
    return withNoStore(NextResponse.json(order));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return withNoStore(NextResponse.json({ error: "Request body is too large." }, { status: 413 }));
    if (error instanceof InvalidJsonError) return withNoStore(NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }));
    const message = error instanceof Error ? error.message : "Unable to start payment.";
    const status = message.includes("not configured") ? 503 : message.includes("not found") || message.includes("available") || message.includes("approved") || message.includes("booking") ? 409 : 500;
    const safeMessage = ["Razorpay is not configured.", "Booking not found.", "Online payment is available after the booking is approved.", "This booking has no available balance for payment.", "This payment attempt is no longer open. Start a new checkout.", "This payment has already been completed.", "That payment attempt belongs to another booking."].includes(message) ? message : "Unable to start payment right now.";
    return withNoStore(NextResponse.json({ error: safeMessage }, { status }));
  }
}
