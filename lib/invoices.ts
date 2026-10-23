import "server-only";

import { Prisma, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireCustomer } from "@/lib/auth/server";
import { getBusinessSettings, type BusinessSettings } from "@/lib/settings";

/**
 * Invoice reads for the two viewers.
 *
 * Kept in one module so the admin screen, the customer screen, and the PDF
 * renderer cannot drift apart on what an invoice contains. The include is
 * deliberately narrower than `bookingInclude`: an invoice needs the customer's
 * name and the billed lines, not inventory reservations, staff, or the whole
 * customer account.
 */
const invoiceInclude = {
  booking: {
    select: {
      id: true,
      eventType: true,
      eventDate: true,
      durationDays: true,
      location: true,
      guestCount: true,
      status: true,
      notes: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      paidAmount: true,
      balanceAmount: true,
      packageNameSnapshot: true,
      packageServicesSnapshot: true,
      customer: {
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      },
      package: { select: { name: true, price: true } },
      bookingServices: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          service: { select: { name: true, pricingMode: true } },
        },
      },
      payments: {
        where: { status: PaymentStatus.CAPTURED },
        select: { id: true, amount: true, stage: true, method: true, status: true, paidAt: true, reference: true },
        orderBy: { paidAt: "desc" as const },
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export type InvoiceView = {
  invoice: InvoiceRecord;
  settings: BusinessSettings;
};

export async function getInvoiceForAdmin(id: string): Promise<InvoiceView | null> {
  await requireAdmin();
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({ where: { id }, include: invoiceInclude, relationLoadStrategy: "join" }),
    getBusinessSettings(),
  ]);
  return invoice ? { invoice, settings } : null;
}

export async function getInvoiceForCustomer(id: string): Promise<InvoiceView | null> {
  const user = await requireCustomer();
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id, booking: { customer: { userId: user.id } } },
      include: invoiceInclude,
      relationLoadStrategy: "join",
    }),
    getBusinessSettings(),
  ]);
  return invoice ? { invoice, settings } : null;
}

export type InvoiceLine = {
  key: string;
  description: string;
  detail: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  included: boolean;
};

/**
 * The billed lines, in the order they appear on the document.
 *
 * A package is a single priced line; the services it bundles are shown beneath it
 * as descriptions rather than as extra charges. Add-ons are priced lines.
 */
export function invoiceLines(booking: InvoiceRecord["booking"]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  const snapshot = Array.isArray(booking.packageServicesSnapshot)
    ? (booking.packageServicesSnapshot as Array<{ name?: unknown; quantity?: unknown }>)
    : [];
  const packageName = booking.package?.name ?? booking.packageNameSnapshot;
  if (packageName) {
    const included = snapshot
      .map((entry) => (typeof entry.name === "string" ? entry.name : null))
      .filter((name): name is string => Boolean(name));
    lines.push({
      key: `package-${packageName}`,
      description: `Package · ${packageName}`,
      detail: included.length > 0 ? `Includes ${included.join(", ")}` : null,
      quantity: 1,
      unitPrice: Number(booking.package?.price ?? 0),
      total: Number(booking.package?.price ?? 0),
      included: false,
    });
  }
  for (const item of booking.bookingServices) {
    lines.push({
      key: item.id,
      description: item.service.name,
      detail: null,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      total: Number(item.totalPrice),
      included: false,
    });
  }
  return lines;
}

export function invoiceStatusLabel(invoice: InvoiceRecord): { label: string; tone: "paid" | "partial" | "unpaid" } {
  const balance = Number(invoice.balanceAmount);
  const paid = Number(invoice.paidAmount);
  if (balance <= 0.009) return { label: "Paid", tone: "paid" };
  if (paid > 0.009) return { label: "Part paid", tone: "partial" };
  return { label: "Unpaid", tone: "unpaid" };
}
