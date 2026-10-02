import { BookingStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { updateBookingStatus } from "@/lib/bookings";
import { accessDenied, requireApiAdmin } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { rateLimitApi, readJsonBody, rejectCrossSiteMutation, rejectOversizedBody, requireJsonContentType, withNoStore, InvalidJsonError, RequestBodyTooLargeError } from "@/lib/security";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 16 * 1024);
  if (oversized) return oversized;
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  try {
    // Enforces identity + approval + admin role + MFA in one place.
    const user = await requireApiAdmin();
    const limited = rateLimitApi(request, "admin-status", { limit: 60, windowMs: 60_000, keySuffix: user.id });
    if (limited) return limited;
    const { id } = await context.params;
    if (!id || id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(id)) return withNoStore(NextResponse.json({ error: "Invalid booking id." }, { status: 400 }));
    const body = (await readJsonBody(request, 16 * 1024)) as { status?: BookingStatus };
    if (!body.status || !Object.values(BookingStatus).includes(body.status)) return withNoStore(NextResponse.json({ error: "Invalid status." }, { status: 400 }));
    const booking = await updateBookingStatus(id, body.status);
    return withNoStore(NextResponse.json({ booking }));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return withNoStore(NextResponse.json({ error: "Request body is too large." }, { status: 413 }));
    if (error instanceof InvalidJsonError) return withNoStore(NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }));
    if (error instanceof AuthError) return accessDenied(error);
    const message = error instanceof Error ? error.message : "Unable to update booking.";
    const safeMessage = ["Booking not found", "cannot move", "inventory", "Invalid status", "updated by another"].some((fragment) => message.includes(fragment)) ? message : "Unable to update the booking right now.";
    return withNoStore(NextResponse.json({ error: safeMessage }, { status: 400 }));
  }
}
