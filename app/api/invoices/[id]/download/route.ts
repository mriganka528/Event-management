import { NextResponse } from "next/server";
import { generateInvoicePdf } from "@/lib/bookings";
import { prisma } from "@/lib/prisma";
import { accessDenied, requireApiUser } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { isAdminRole } from "@/lib/access-policy";
import { rateLimitApi, withNoStore } from "@/lib/security";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const limited = rateLimitApi(request, "invoice-download", { limit: 30, windowMs: 10 * 60_000 });
  if (limited) return limited;
  try {
    // An authenticated-but-unapproved account must not be able to download an
    // invoice even if it somehow guesses an id.
    const user = await requireApiUser();
    const { id } = await context.params;
    if (!id || id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(id)) return withNoStore(NextResponse.json({ error: "Invalid invoice id." }, { status: 400 }));
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { booking: { select: { customer: { select: { userId: true } } } } },
    });
    if (!invoice) return withNoStore(NextResponse.json({ error: "Invoice not found." }, { status: 404 }));
    const isAdmin = isAdminRole(user.role);
    if (!isAdmin && invoice.booking.customer.userId !== user.id) {
      return withNoStore(NextResponse.json({ error: "Invoice not found." }, { status: 404 }));
    }
    const file = await generateInvoicePdf(id);
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${file.fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return accessDenied(error, "Unable to generate this invoice right now.");
    const message = error instanceof Error ? error.message : "Unable to generate invoice";
    return withNoStore(NextResponse.json({ error: message === "Invoice not found." ? message : "Unable to generate this invoice right now." }, { status: message === "Invoice not found." ? 404 : 400 }));
  }
}
