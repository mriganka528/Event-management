import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { slugify } from "@/lib/utils";
import { formatIstDate } from "@/lib/ist";

/**
 * Everything the renderer needs from the database, described structurally so
 * the PDF can be exercised without opening a connection. `Prisma.Decimal`
 * satisfies `PdfValue` through `toString`, which is exactly how it is printed.
 */
type PdfValue = number | string | { toString(): string };

export type InvoicePdfSettings = {
  businessName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  currency: string;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  issuedAt: Date;
  taxRate: PdfValue;
  totalAmount: PdfValue;
  paidAmount: PdfValue;
  balanceAmount: PdfValue;
  booking: {
    eventType: string;
    eventDate: Date;
    durationDays: number;
    guestCount: number;
    location: string;
    subtotal: PdfValue;
    taxAmount: PdfValue;
    packageNameSnapshot: string | null;
    packageServicesSnapshot: unknown;
    customer: {
      user: { firstName: string; lastName: string | null; email: string; phone: string | null };
    };
    package: { name: string; price: PdfValue } | null;
    bookingServices: Array<{
      id: string;
      quantity: number;
      unitPrice: PdfValue;
      totalPrice: PdfValue;
      service: { name: string };
    }>;
    payments: Array<{
      id: string;
      amount: PdfValue;
      stage: string;
      method: string;
      paidAt: Date;
      reference: string | null;
    }>;
  };
};

const INVOICE_BRAND = rgb(0.827, 0.541, 0.086);
const INVOICE_INK = rgb(0.118, 0.106, 0.086);
const INVOICE_MUTED = rgb(0.435, 0.4, 0.357);
const INVOICE_LINE = rgb(0.88, 0.84, 0.78);
const INVOICE_SOFT = rgb(0.996, 0.957, 0.878);
const INVOICE_GREEN = rgb(0.153, 0.396, 0.271);
const INVOICE_RED = rgb(0.608, 0.204, 0.204);

/**
 * pdf-lib's built-in fonts are WinAnsi, which cannot encode most non-Latin
 * scripts. Replacing the handful of punctuation marks we generate, and any
 * remaining unsupported glyph, keeps a customer with an unusual name from
 * turning the download into a 500 at the very last step.
 */
function sanitizePdfText(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\u00A1-\u00FF]/g, "?");
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizePdfText(text).replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: RGB = INVOICE_INK) {
  const safe = sanitizePdfText(text);
  page.drawText(safe, { x: rightX - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

/**
 * The invoice document.
 *
 * Pure layout: no database, no request context. The document is one page for a
 * normal event and paginates when the line list grows.
 */
export async function renderInvoicePdf(invoice: InvoicePdfData, settings: InvoicePdfSettings) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const customer = invoice.booking.customer.user;
  const businessName = settings.businessName || "Event Management";
  const currency = settings.currency || "INR";
  const moneyFormatter = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (value: unknown) => `${currency} ${moneyFormatter.format(Number(value))}`;
  // IST, like every other date the business shows. See `lib/ist.ts`.
  const dateLabel = (value: Date) => formatIstDate(value);

  const width = 595;
  const height = 842;
  const margin = 48;
  const contentWidth = width - margin * 2;
  const itemWidth = 255;
  const qtyRight = margin + 330;
  const rateRight = margin + 425;
  const amountRight = width - margin - 10;

  let page = pdfDoc.addPage([width, height]);
  const pages: PDFPage[] = [page];
  const newPage = () => {
    page = pdfDoc.addPage([width, height]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: INVOICE_BRAND });
    page.drawText(sanitizePdfText(businessName), { x: margin, y: height - 44, size: 12, font: boldFont, color: INVOICE_INK });
    drawRight(page, `Invoice ${invoice.invoiceNumber}`, width - margin, height - 44, 9, font, INVOICE_MUTED);
    return height - 70;
  };

  const drawTableHeader = (top: number) => {
    page.drawRectangle({ x: margin, y: top - 7, width: contentWidth, height: 24, color: INVOICE_SOFT });
    page.drawText("ITEM", { x: margin + 10, y: top, size: 8, font: boldFont, color: INVOICE_MUTED });
    drawRight(page, "QTY", qtyRight, top, 8, boldFont, INVOICE_MUTED);
    drawRight(page, "RATE", rateRight, top, 8, boldFont, INVOICE_MUTED);
    drawRight(page, "AMOUNT", amountRight, top, 8, boldFont, INVOICE_MUTED);
    return top - 30;
  };

  // ---- header -------------------------------------------------------------
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: INVOICE_BRAND });
  page.drawText(sanitizePdfText(businessName), { x: margin, y: height - 58, size: 20, font: boldFont, color: INVOICE_INK });
  let leftY = height - 78;
  const contactLines = [settings.address, settings.city].filter(Boolean).join(", ");
  for (const line of [contactLines, [settings.email, settings.phone].filter(Boolean).join("  |  ")].filter(Boolean)) {
    page.drawText(sanitizePdfText(line), { x: margin, y: leftY, size: 9, font, color: INVOICE_MUTED });
    leftY -= 12;
  }

  drawRight(page, "INVOICE", width - margin, height - 58, 9, boldFont, INVOICE_BRAND);
  drawRight(page, invoice.invoiceNumber, width - margin, height - 80, 16, boldFont, INVOICE_INK);
  drawRight(page, `Issued ${dateLabel(invoice.issuedAt)}`, width - margin, height - 96, 9, font, INVOICE_MUTED);

  const balance = Number(invoice.balanceAmount);
  const paid = Number(invoice.paidAmount);
  const statusLabel = balance <= 0.009 ? "PAID" : paid > 0.009 ? "PART PAID" : "UNPAID";
  const statusColor = statusLabel === "PAID" ? INVOICE_GREEN : statusLabel === "UNPAID" ? INVOICE_RED : INVOICE_BRAND;
  drawRight(page, statusLabel, width - margin, height - 116, 9, boldFont, statusColor);
  const statusWidth = boldFont.widthOfTextAtSize(statusLabel, 9);
  page.drawLine({ start: { x: width - margin - statusWidth, y: height - 119 }, end: { x: width - margin, y: height - 119 }, thickness: 1, color: statusColor });

  let y = Math.min(leftY, height - 132) - 8;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: INVOICE_LINE });
  y -= 24;

  // ---- parties ------------------------------------------------------------
  page.drawText("BILLED TO", { x: margin, y, size: 8, font: boldFont, color: INVOICE_MUTED });
  page.drawText("EVENT", { x: margin + 280, y, size: 8, font: boldFont, color: INVOICE_MUTED });
  y -= 16;

  page.drawText(sanitizePdfText(`${customer.firstName} ${customer.lastName ?? ""}`.trim()), { x: margin, y, size: 11, font: boldFont, color: INVOICE_INK });
  page.drawText(sanitizePdfText(customer.email), { x: margin, y: y - 13, size: 9, font, color: INVOICE_MUTED });
  let leftBottom = y - 13;
  if (customer.phone) {
    page.drawText(sanitizePdfText(customer.phone), { x: margin, y: y - 26, size: 9, font, color: INVOICE_MUTED });
    leftBottom = y - 26;
  }

  const eventLines = [
    `${formatEnumText(invoice.booking.eventType)} - ${dateLabel(invoice.booking.eventDate)}`,
    `${invoice.booking.durationDays} day${invoice.booking.durationDays === 1 ? "" : "s"} - ${invoice.booking.guestCount} guests`,
    invoice.booking.location,
  ];
  page.drawText(sanitizePdfText(eventLines[0]), { x: margin + 280, y, size: 10, font: boldFont, color: INVOICE_INK });
  page.drawText(sanitizePdfText(eventLines[1]), { x: margin + 280, y: y - 13, size: 9, font, color: INVOICE_MUTED });
  const locationLines = wrapPdfText(eventLines[2], font, 9, contentWidth - 280);
  locationLines.slice(0, 2).forEach((line, index) => page.drawText(line, { x: margin + 280, y: y - 26 - index * 11, size: 9, font, color: INVOICE_MUTED }));

  y = Math.min(leftBottom, y - 26 - Math.max(0, locationLines.length - 1) * 11) - 26;
  y = drawTableHeader(y);

  // ---- lines --------------------------------------------------------------
  type PdfLine = { description: string; detail: string | null; quantity: number; unitPrice: unknown; total: unknown };
  const snapshot = Array.isArray(invoice.booking.packageServicesSnapshot)
    ? (invoice.booking.packageServicesSnapshot as Array<{ name?: unknown }>)
    : [];
  const packageName = invoice.booking.package?.name;
  const lines: PdfLine[] = [];
  if (packageName) {
    const included = snapshot.map((entry) => (typeof entry.name === "string" ? entry.name : null)).filter((name): name is string => Boolean(name));
    lines.push({
      description: `Package - ${packageName}`,
      detail: included.length > 0 ? `Includes ${included.join(", ")}` : null,
      quantity: 1,
      unitPrice: invoice.booking.package?.price ?? 0,
      total: invoice.booking.package?.price ?? 0,
    });
  }
  for (const item of invoice.booking.bookingServices) {
    lines.push({
      description: item.service.name,
      detail: null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.totalPrice,
    });
  }

  lines.forEach((line, index) => {
    const descriptionLines = wrapPdfText(line.description, font, 10, itemWidth);
    const detailLines = line.detail ? wrapPdfText(line.detail, font, 8, itemWidth) : [];
    const rowHeight = Math.max(30, descriptionLines.length * 12 + detailLines.length * 10 + 12);
    if (y - rowHeight < 150) {
      y = newPage();
      y = drawTableHeader(y);
    }
    const rowTop = y;
    const rowBottom = rowTop - rowHeight;
    if (index % 2 === 1) {
      page.drawRectangle({ x: margin, y: rowBottom, width: contentWidth, height: rowHeight, color: rgb(0.992, 0.975, 0.952) });
    }
    let textY = rowTop - 15;
    for (const description of descriptionLines) {
      page.drawText(description, { x: margin + 10, y: textY, size: 10, font, color: INVOICE_INK });
      textY -= 12;
    }
    for (const detail of detailLines) {
      page.drawText(detail, { x: margin + 10, y: textY, size: 8, font, color: INVOICE_MUTED });
      textY -= 10;
    }
    drawRight(page, String(line.quantity), qtyRight, rowTop - 15, 10, font, INVOICE_MUTED);
    drawRight(page, money(line.unitPrice), rateRight, rowTop - 15, 10, font, INVOICE_MUTED);
    drawRight(page, money(line.total), amountRight, rowTop - 15, 10, boldFont, INVOICE_INK);
    page.drawLine({ start: { x: margin, y: rowBottom }, end: { x: width - margin, y: rowBottom }, thickness: 0.5, color: INVOICE_LINE });
    y = rowBottom;
  });

  if (lines.length === 0) {
    page.drawText("No billable lines were recorded.", { x: margin + 10, y: y - 18, size: 10, font, color: INVOICE_MUTED });
    y -= 36;
  }

  // ---- totals and payment note -------------------------------------------
  if (y < 250) {
    y = newPage();
  }
  y -= 24;
  const totalsX = width - margin - 210;

  const noteLines = wrapPdfText(
    balance <= 0.009
      ? "This invoice is settled in full. Thank you."
      : `A balance of ${money(balance)} remains. You can pay it from your customer dashboard.`,
    font,
    9,
    contentWidth - 240,
  );
  noteLines.forEach((line, index) => page.drawText(line, { x: margin, y: y - index * 12, size: 9, font, color: INVOICE_MUTED }));

  const totals: Array<{ label: string; value: unknown; muted?: boolean; emphasis?: boolean }> = [
    { label: "Subtotal", value: invoice.booking.subtotal, muted: true },
    { label: `Tax (${Math.round(Number(invoice.taxRate) * 1000) / 10}%)`, value: invoice.booking.taxAmount, muted: true },
    { label: "Total", value: invoice.totalAmount, emphasis: true },
  ];
  let totalsY = y;
  for (const entry of totals) {
    page.drawText(entry.label, { x: totalsX, y: totalsY, size: 9, font, color: INVOICE_MUTED });
    drawRight(page, money(entry.value), width - margin, totalsY, entry.emphasis ? 11 : 9, entry.emphasis ? boldFont : font, INVOICE_INK);
    totalsY -= entry.emphasis ? 20 : 15;
  }

  // A rule separates the invoice total from the two lines that settle it, so
  // the eye can tell where the sum ends and the payments begin.
  page.drawLine({ start: { x: totalsX - 10, y: totalsY + 6 }, end: { x: width - margin, y: totalsY + 6 }, thickness: 0.6, color: INVOICE_LINE });
  totalsY -= 12;

  // "Paid" and "Balance" are separate rows with room between them. They used
  // to share one band, and the highlighted Balance box was drawn straight
  // over the Paid line, so the two amounts read as one overlapping number.
  page.drawText("Paid", { x: totalsX, y: totalsY, size: 9, font, color: INVOICE_MUTED });
  drawRight(page, money(invoice.paidAmount), width - margin, totalsY, 9, font, INVOICE_INK);
  totalsY -= 20;

  page.drawRectangle({ x: totalsX - 10, y: totalsY - 8, width: 220, height: 24, color: INVOICE_SOFT });
  page.drawText("Balance", { x: totalsX, y: totalsY, size: 10, font: boldFont, color: INVOICE_INK });
  drawRight(page, money(invoice.balanceAmount), width - margin, totalsY, 10, boldFont, INVOICE_INK);
  totalsY -= 20;

  y = Math.min(y - noteLines.length * 12, totalsY) - 30;

  // ---- payment history ----------------------------------------------------
  if (invoice.booking.payments.length > 0) {
    if (y < 120) y = newPage();
    page.drawText("PAYMENTS RECEIVED", { x: margin, y, size: 8, font: boldFont, color: INVOICE_MUTED });
    y -= 16;
    for (const payment of invoice.booking.payments) {
      if (y < 60) y = newPage();
      page.drawText(
        sanitizePdfText(`${money(payment.amount)}  -  ${payment.stage.toLowerCase()} via ${payment.method.toLowerCase()} - ${dateLabel(payment.paidAt)}${payment.reference ? ` - ${payment.reference}` : ""}`),
        { x: margin, y, size: 8.5, font, color: INVOICE_MUTED },
      );
      y -= 13;
    }
  }

  // ---- footer -------------------------------------------------------------
  const footerText = `Thank you for choosing ${businessName}. Questions? ${settings.email || "Contact our team."}`;
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: margin, y: 46 }, end: { x: width - margin, y: 46 }, thickness: 0.6, color: INVOICE_LINE });
    current.drawText(sanitizePdfText(footerText).slice(0, 110), { x: margin, y: 32, size: 8, font, color: INVOICE_MUTED });
    if (pages.length > 1) {
      drawRight(current, `Page ${index + 1} of ${pages.length}`, width - margin, 32, 8, font, INVOICE_MUTED);
    }
  });

  return { fileName: `${slugify(invoice.invoiceNumber)}.pdf`, bytes: await pdfDoc.save() };
}

/** `WEDDING` -> `Wedding`, for a document a customer reads. */
function formatEnumText(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
