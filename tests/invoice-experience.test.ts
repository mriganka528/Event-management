import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { renderInvoicePdf, type InvoicePdfData } from "@/lib/invoice-pdf";

/**
 * Invoice experience contract.
 *
 * Three complaints, three checks:
 *  - there was no feedback while a PDF was being prepared;
 *  - there was no way to read the invoice without downloading it;
 *  - the document itself looked like a plain text dump.
 *
 * The HTML view is the fast path; the PDF keeps working for records.
 */

test("both viewers have a real invoice page", () => {
  assert.ok(existsSync("app/(admin)/admin/invoices/[id]/page.tsx"));
  assert.ok(existsSync("app/(customer)/customer/invoices/[id]/page.tsx"));
  for (const path of ["app/(admin)/admin/invoices/[id]/page.tsx", "app/(customer)/customer/invoices/[id]/page.tsx"]) {
    const page = readFileSync(path, "utf8");
    assert.match(page, /InvoiceDocument/, `${path} must render the shared document`);
    assert.match(page, /notFound\(\)/, "an invoice the viewer may not see must 404, not leak existence");
  }
});

test("a customer can only open their own invoice", () => {
  const invoices = readFileSync("lib/invoices.ts", "utf8");
  assert.match(invoices, /export async function getInvoiceForAdmin/);
  assert.match(invoices, /export async function getInvoiceForCustomer/);
  const customerRead = invoices.slice(invoices.indexOf("export async function getInvoiceForCustomer"));
  assert.match(customerRead, /booking: \{ customer: \{ userId: user\.id \} \}/);
  assert.match(customerRead, /requireCustomer\(\)/);
  assert.match(invoices, /requireAdmin\(\)/);
});

test("the PDF button says that it is working", () => {
  const button = readFileSync("components/invoices/invoice-download-button.tsx", "utf8");
  assert.match(button, /Preparing PDF…/);
  assert.match(button, /LoaderCircle/);
  assert.match(button, /response\.headers\.get\("content-disposition"\)/);
});

test("generating an invoice is also visibly in progress", () => {
  const submit = readFileSync("components/forms/submit-button.tsx", "utf8");
  assert.match(submit, /pendingLabel/);
  const admin = readFileSync("app/(admin)/admin/invoices/page.tsx", "utf8");
  assert.match(admin, /pendingLabel="Generating invoice…"/);
  assert.match(admin, /getInvoiceableBookings\(\)/);
});

test("the invoice list links to the preview instead of downloading blind", () => {
  const admin = readFileSync("app/(admin)/admin/invoices/page.tsx", "utf8");
  assert.match(admin, /<InvoiceViewLink href=\{`\/admin\/invoices\/\$\{invoice\.id\}`\}/);
  assert.match(admin, /InvoiceDownloadButton/);

  const booking = readFileSync("app/(customer)/customer/bookings/[id]/page.tsx", "utf8");
  assert.match(booking, /InvoiceViewLink href=\{`\/customer\/invoices\/\$\{booking\.invoice\.id\}`\}/);
  assert.match(booking, /InvoiceDownloadButton/);
});

test("the invoice link says it is opening the invoice", () => {
  const link = readFileSync("components/invoices/invoice-view-link.tsx", "utf8");
  assert.match(link, /useLinkStatus/);
  assert.match(link, /LoaderCircle/);
  assert.match(link, /Opening invoice…/, "the link must name the work it is doing");
  assert.match(link, /animate-spin/, "the pending state must be visible, not just textual");

  for (const path of [
    "app/(admin)/admin/invoices/page.tsx",
    "app/(admin)/admin/bookings/[id]/page.tsx",
    "app/(customer)/customer/dashboard/page.tsx",
    "app/(customer)/customer/bookings/[id]/page.tsx",
    "components/admin/booking-operations.tsx",
  ]) {
    assert.match(readFileSync(path, "utf8"), /InvoiceViewLink/, `${path} must use the in-flight invoice link`);
  }
});

test("the PDF renderer does its two reads together and paginates", () => {
  const bookings = readFileSync("lib/bookings.ts", "utf8");
  const fetch = bookings.slice(bookings.indexOf("export async function generateInvoicePdf"));
  assert.match(fetch, /Promise\.all\(\[/, "invoice and business profile must not be sequential");
  assert.match(fetch, /getBusinessSettings\(\)/, "the profile is cached rather than re-read");
  assert.match(fetch, /renderInvoicePdf\(invoice, settings\)/);

  const pdf = readFileSync("lib/invoice-pdf.ts", "utf8");
  assert.match(pdf, /INVOICE_BRAND/);
  assert.match(pdf, /drawTableHeader/);
  assert.match(pdf, /wrapPdfText/);
  assert.match(pdf, /PAID|PART PAID|UNPAID/);
  assert.match(pdf, /Payment history|PAYMENTS RECEIVED/);
});

test("a real invoice renders to a PDF", async () => {
  const invoice: InvoicePdfData = {
    invoiceNumber: "INV-1001",
    issuedAt: new Date("2026-10-21T10:00:00Z"),
    taxRate: 0.18,
    totalAmount: 118_000,
    paidAmount: 20_000,
    balanceAmount: 98_000,
    booking: {
      eventType: "WEDDING",
      eventDate: new Date("2026-11-12T10:00:00Z"),
      durationDays: 1,
      guestCount: 200,
      location: "Pune, Maharashtra",
      subtotal: 100_000,
      taxAmount: 18_000,
      packageNameSnapshot: "Royal Wedding",
      packageServicesSnapshot: [{ name: "Decor" }, { name: "Catering" }],
      customer: {
        user: { firstName: "Asha", lastName: "Rao", email: "asha@example.com", phone: "+91 98765 43210" },
      },
      package: { name: "Royal Wedding", price: 90_000 },
      bookingServices: [
        { id: "s1", quantity: 2, unitPrice: 5_000, totalPrice: 10_000, service: { name: "Lighting" } },
      ],
      payments: [
        { id: "p1", amount: 20_000, stage: "ADVANCE", method: "UPI", paidAt: new Date("2026-10-20"), reference: "pay_123" },
      ],
    },
  };

  const { fileName, bytes } = await renderInvoicePdf(invoice, {
    businessName: "Golden Hour Events",
    email: "hello@goldenhour.example",
    phone: "+91 98765 43210",
    address: "12 Market Road",
    city: "Pune",
    currency: "INR",
  });

  assert.equal(fileName, "inv-1001.pdf");
  assert.ok(bytes.length > 2_000, "a full invoice should produce more than an empty document");
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-");
});

test("the shared document carries the full invoice rather than a summary", () => {
  const document = readFileSync("components/invoices/invoice-document.tsx", "utf8");
  for (const label of ["Billed to", "Payment details", "Payment history", "Invoice", "Balance", "Subtotal", "Tax"]) {
    assert.match(document, new RegExp(label, "i"), `the document must show ${label}`);
  }
  assert.match(document, /var\(--card\)/);
  assert.match(document, /var\(--brand-softer\)/);
});

test("invoice pages are private and get an instant skeleton", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /source: "\/customer\/invoices\/:path\*", headers: privateHeaders/);

  for (const path of ["app/(admin)/admin/invoices/[id]/loading.tsx", "app/(customer)/customer/invoices/[id]/loading.tsx"]) {
    assert.ok(existsSync(path));
    assert.match(readFileSync(path, "utf8"), /InvoicePageSkeleton/, `${path} must use the invoice-shaped skeleton`);
  }

  const skeleton = readFileSync("components/layout/loading-skeletons.tsx", "utf8");
  const invoiceSkeleton = skeleton.slice(skeleton.indexOf("export function InvoicePageSkeleton"), skeleton.indexOf("export function PublicDetailPageSkeleton"));
  assert.match(invoiceSkeleton, /Preparing your invoice…/);
  assert.match(invoiceSkeleton, /role="status"/);
  assert.match(invoiceSkeleton, /animate-spin/);
  assert.match(invoiceSkeleton, /bg-\[var\(--card\)\]/, "the skeleton must preview the invoice paper, not a generic workspace");
});
