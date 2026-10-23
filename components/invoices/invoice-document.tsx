import Image from "next/image";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { invoiceLines, invoiceStatusLabel, type InvoiceRecord } from "@/lib/invoices";
import type { BusinessSettings } from "@/lib/settings";

/**
 * The invoice as a document, shared by the admin and customer viewers.
 *
 * Rendered as real HTML rather than an embedded PDF: it paints on the first
 * response, follows the active theme, and gives a customer something to read
 * before deciding whether to download. The PDF is still one click away.
 */
export function InvoiceDocument({
  invoice,
  settings,
}: {
  invoice: InvoiceRecord;
  settings: BusinessSettings;
}) {
  const currency = settings.currency || "INR";
  const money = (value: unknown) => formatCurrency(Number(value), currency);
  const booking = invoice.booking;
  const customer = booking.customer.user;
  const status = invoiceStatusLabel(invoice);
  const lines = invoiceLines(booking);
  // Invoice loaders already filter this, but the document is the last line of
  // defence: an unapproved cash claim is never money received.
  const capturedPayments = booking.payments.filter((payment) => payment.status === "CAPTURED");
  const statusClass =
    status.tone === "paid"
      ? "bg-[var(--success-soft)] text-[var(--success-text)]"
      : status.tone === "partial"
        ? "bg-[var(--warning-soft)] text-[var(--warning-text)]"
        : "bg-[var(--danger-soft)] text-[var(--danger-text)]";

  return (
    <article className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[var(--card)] shadow-[0_24px_70px_rgba(61,40,14,0.10)] print:rounded-none print:border-0 print:shadow-none">
      <div className="h-1.5 bg-[linear-gradient(90deg,#d38a16,#f7d194,#d38a16)]" />
      <div className="space-y-8 p-6 sm:p-10">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            {settings.logoUrl ? (
              <Image
                src={settings.logoUrl}
                alt={`${settings.businessName} logo`}
                width={160}
                height={56}
                className="h-12 w-auto max-w-[160px] object-contain"
              />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-lg font-bold text-[var(--brand-dark)]">
                {settings.businessName.trim().slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <p className="text-xl font-semibold tracking-tight">{settings.businessName}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {[settings.address, settings.city].filter(Boolean).join(", ") || "Event planning and production"}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {[settings.email, settings.phone].filter(Boolean).join(" · ") || "Contact details on file"}
              </p>
            </div>
          </div>

          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--brand-dark)]">Invoice</p>
            <p className="mt-1 text-2xl font-semibold">{invoice.invoiceNumber}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Issued {formatDateShort(invoice.issuedAt)}</p>
            <span className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusClass}`}>
              {status.label}
            </span>
          </div>
        </header>

        <div className="grid gap-4 rounded-[24px] bg-[var(--surface-muted)] p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Billed to</p>
            <p className="mt-2 font-semibold">
              {customer.firstName} {customer.lastName ?? ""}
            </p>
            <p className="break-all text-sm text-[var(--muted)]">{customer.email}</p>
            {customer.phone ? <p className="text-sm text-[var(--muted)]">{customer.phone}</p> : null}
          </div>
          <div className="space-y-2 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Event</p>
            <p className="flex items-center gap-2 font-semibold sm:justify-end">
              <CalendarDays className="h-4 w-4 text-[var(--brand-dark)]" />
              {formatDateShort(booking.eventDate)} · {booking.durationDays} day{booking.durationDays === 1 ? "" : "s"}
            </p>
            <p className="flex items-center gap-2 text-sm text-[var(--muted)] sm:justify-end">
              <MapPin className="h-4 w-4" />
              {booking.location}
            </p>
            <p className="flex items-center gap-2 text-sm text-[var(--muted)] sm:justify-end">
              <Users className="h-4 w-4" />
              {booking.guestCount} guests · {formatEnumLabel(booking.eventType)}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                <th className="rounded-l-xl bg-[var(--surface-muted)] px-4 py-3">Item</th>
                <th className="bg-[var(--surface-muted)] px-4 py-3 text-right">Qty</th>
                <th className="bg-[var(--surface-muted)] px-4 py-3 text-right">Rate</th>
                <th className="rounded-r-xl bg-[var(--surface-muted)] px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[var(--muted)]">
                    No billable lines were recorded.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.key} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-4">
                      <p className="font-medium">{line.description}</p>
                      {line.detail ? <p className="mt-1 text-xs text-[var(--muted)]">{line.detail}</p> : null}
                    </td>
                    <td className="px-4 py-4 text-right text-[var(--muted)]">{line.quantity}</td>
                    <td className="px-4 py-4 text-right text-[var(--muted)]">{money(line.unitPrice)}</td>
                    <td className="px-4 py-4 text-right font-medium">{money(line.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm text-sm text-[var(--muted)]">
            <p className="font-semibold text-[var(--foreground)]">Payment details</p>
            <p className="mt-2">
              {status.tone === "paid"
                ? "This invoice is settled in full. Thank you."
                : `A balance of ${money(invoice.balanceAmount)} remains. You can pay it from your customer dashboard.`}
            </p>
            {booking.notes ? <p className="mt-3 whitespace-pre-wrap text-xs">Note: {booking.notes}</p> : null}
          </div>
          <div className="w-full max-w-xs space-y-2 text-sm sm:ml-auto">
            <div className="flex justify-between gap-6">
              <span className="text-[var(--muted)]">Subtotal</span>
              <span>{money(booking.subtotal)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[var(--muted)]">Tax ({Math.round(Number(invoice.taxRate) * 1000) / 10}%)</span>
              <span>{money(booking.taxAmount)}</span>
            </div>
            <div className="flex justify-between gap-6 border-t border-[var(--line)] pt-2 text-base font-semibold">
              <span>Total</span>
              <span>{money(invoice.totalAmount)}</span>
            </div>
            {/* "Paid" and "Balance" are separate lines. They are the two sides
                of what is still owed, so they are separated rather than set
                one on top of the other. */}
            <div className="flex justify-between gap-6 pt-1 text-[var(--success-text)]">
              <span>Paid</span>
              <span>{money(invoice.paidAmount)}</span>
            </div>
            <div className="flex justify-between gap-6 rounded-xl bg-[var(--brand-softer)] px-3 py-2 font-semibold">
              <span>Balance due</span>
              <span>{money(invoice.balanceAmount)}</span>
            </div>
          </div>
        </div>

        {capturedPayments.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Payment history</p>
            <div className="mt-3 grid gap-2">
              {capturedPayments.map((payment) => (
                <div key={payment.id} className="flex flex-col gap-1 rounded-xl border border-[var(--line)] px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium">{money(payment.amount)}</span>
                  <span className="text-[var(--muted)]">
                    {payment.stage.toLowerCase()} · {payment.method.toLowerCase()} · {formatDateShort(payment.paidAt)}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <footer className="border-t border-[var(--line)] pt-5 text-center text-xs text-[var(--muted)]">
          Thank you for choosing {settings.businessName}. Questions about this invoice? Reply to {settings.email || "our team"}.
        </footer>
      </div>
    </article>
  );
}

/** Event types are Prisma enums (`WEDDING`, `BIRTHDAY`) and read badly as slugs. */
function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
