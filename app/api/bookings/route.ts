import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createBookingForPublicCustomer, getBookingFormData } from "@/lib/bookings";
import { customerFacingBookingMessage } from "@/lib/public-booking-error";
import { rateLimitApi, readJsonBody, rejectCrossSiteMutation, rejectOversizedBody, withNoStore, InvalidJsonError, RequestBodyTooLargeError } from "@/lib/security";

export async function GET(request: Request) {
  const limited = rateLimitApi(request, "catalog", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const { services, packages, capacity } = await getBookingFormData();
    return withNoStore(NextResponse.json({
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        slug: service.slug,
        basePrice: Number(service.basePrice),
        unitLabel: service.unitLabel,
        pricingMode: service.pricingMode,
        inventoryCategories: service.inventoryCategories,
      })),
      packages: packages.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        price: Number(item.price),
        imageUrl: item.imageUrl,
      })),
      // The same per-category availability the booking form uses, so an API
      // client cannot build a quote the server is going to refuse.
      capacity,
    }));
  } catch {
    return withNoStore(NextResponse.json({ services: [], packages: [], capacity: {} }));
  }
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 128 * 1024);
  if (oversized) return oversized;
  const limited = rateLimitApi(request, "booking", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  try {
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const isJson = contentType === "application/json";
    const isForm = contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data";
    if (!isJson && !isForm) return withNoStore(NextResponse.json({ error: "Unsupported content type." }, { status: 415 }));
    const raw = isJson ? await readJsonBody(request, 128 * 1024) : Object.fromEntries((await request.formData()).entries());
    const booking = await createBookingForPublicCustomer(raw);
    return withNoStore(NextResponse.json({
      booking: {
        id: booking.id,
        publicToken: booking.publicToken,
        status: booking.status,
        eventType: booking.eventType,
        eventDate: booking.eventDate,
        totalAmount: Number(booking.totalAmount),
      },
    }, { status: 201 }));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return withNoStore(NextResponse.json({ error: "Request body is too large." }, { status: 413 }));
    if (error instanceof InvalidJsonError) return withNoStore(NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }));
    if (error instanceof ZodError) return withNoStore(NextResponse.json({ error: "Please check the required booking fields and try again." }, { status: 400 }));
    // The same list the form's action uses, so a failure reads identically
    // whether it arrived through the page or the API. See
    // `lib/public-booking-error.ts` for what drifts when the two copies differ.
    const safeMessage = customerFacingBookingMessage(error);
    if (safeMessage) return withNoStore(NextResponse.json({ error: safeMessage }, { status: 400 }));
    console.error("[booking] api request failed", error);
    return withNoStore(NextResponse.json({ error: "We could not create the booking right now. Please try again." }, { status: 500 }));
  }
}
