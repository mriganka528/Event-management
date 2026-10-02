import { NextResponse } from "next/server";
import { createPayment } from "@/lib/bookings";
import { accessDenied, requireApiAdmin } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { rateLimitApi, readJsonBody, rejectCrossSiteMutation, rejectOversizedBody, requireJsonContentType, withNoStore, InvalidJsonError, RequestBodyTooLargeError } from "@/lib/security";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 16 * 1024);
  if (oversized) return oversized;
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  try {
    const user = await requireApiAdmin();
    const limited = rateLimitApi(request, "admin-payment", { limit: 60, windowMs: 60_000, keySuffix: user.id });
    if (limited) return limited;
    const payment = await createPayment(await readJsonBody(request, 16 * 1024));
    return withNoStore(NextResponse.json({ payment }, { status: 201 }));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return withNoStore(NextResponse.json({ error: "Request body is too large." }, { status: 413 }));
    if (error instanceof InvalidJsonError) return withNoStore(NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }));
    if (error instanceof AuthError) return accessDenied(error);
    const message = error instanceof Error ? error.message : "Unable to record payment.";
    const safeMessage = ["Booking not found", "Payment cannot", "Payments cannot", "balance changed"].some((fragment) => message.includes(fragment)) ? message : "Unable to record the payment right now.";
    return withNoStore(NextResponse.json({ error: safeMessage }, { status: 400 }));
  }
}
