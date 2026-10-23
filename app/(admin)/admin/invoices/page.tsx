import type { Metadata } from "next";
import { FilePlus2, Receipt } from "lucide-react";
import { getAdminInvoices, getInvoiceableBookings } from "@/lib/admin-data";
import { createInvoiceFormAction } from "@/lib/form-actions";
import { AdminSearch } from "@/components/admin/admin-search";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoiceViewLink } from "@/components/invoices/invoice-view-link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoices",
  description: "Issue, preview, and download the invoice for any booking that has been approved.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const [invoices, invoiceableBookings] = await Promise.all([getAdminInvoices(), getInvoiceableBookings()]);
  // Rows stay mounted and non-matching ones are hidden so the browser can
  // reveal them again without a round trip.
  const visibility = rowFilter(query);
  const invoiceText = (invoice: (typeof invoices)[number]) =>
    rowText(
      invoice.id,
      invoice.invoiceNumber,
      invoice.booking.customer.user.firstName,
      invoice.booking.customer.user.lastName,
      invoice.booking.customer.user.email,
      invoice.booking.eventType,
      invoice.booking.location,
    );
  const totalOutstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.balanceAmount), 0);

  return (
    <main className="space-y-6">
      <AdminSearch label="Search invoices" placeholder="Search by invoice number, customer, or booking…" />

      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Invoice center</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">A clear paper trail.</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Preview an invoice instantly in the browser, then download the PDF when you need a copy. Payment balances stay synchronized with the finance desk.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Issued invoices</p><p className="mt-2 text-3xl font-semibold">{invoices.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Outstanding on invoices</p><p className="mt-2 text-3xl font-semibold">{formatCurrency(totalOutstanding)}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Bookings needing invoices</p><p className="mt-2 text-3xl font-semibold">{invoiceableBookings.length}</p></CardContent></Card>
      </section>

      <Card id="generate-invoice">
        <CardHeader>
          <CardTitle>Generate an invoice</CardTitle>
          <CardDescription>Choose a booking that does not have an invoice yet. The button stays busy until the invoice exists.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoiceableBookings.length > 0 ? (
            <ActionForm action={createInvoiceFormAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <label className="grid flex-1 gap-2 text-sm font-medium">
                Booking
                <Select
                  name="bookingId"
                  options={invoiceableBookings.map((booking) => ({
                    label: `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""} · ${formatCurrency(booking.totalAmount)}`,
                    value: booking.id,
                  }))}
                />
              </label>
              <SubmitButton pendingLabel="Generating invoice…"><FilePlus2 className="mr-2 h-4 w-4" />Generate invoice</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm text-[var(--success-text)]">All visible bookings have an invoice.</p>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-2xl">Issued invoices</CardTitle>
          <CardDescription>Open an invoice to read it in the browser, or download the PDF.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="p-6"><EmptyState title="No invoices issued" description="Generate the first invoice from a booking above." /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id} data-row-id={invoice.id} data-row-text={invoiceText(invoice)} style={visibility(invoiceText(invoice))}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-semibold">
                          <Receipt className="h-4 w-4 text-[var(--brand-dark)]" />
                          {invoice.invoiceNumber}
                        </div>
                      </TableCell>
                      <TableCell>{invoice.booking.customer.user.firstName} {invoice.booking.customer.user.lastName ?? ""}</TableCell>
                      <TableCell>{invoice.booking.eventType.toLowerCase()} · {invoice.booking.location}</TableCell>
                      <TableCell>{formatCurrency(invoice.totalAmount)}</TableCell>
                      <TableCell>
                        <Badge className={Number(invoice.balanceAmount) > 0 ? "bg-[var(--warning-soft)] text-[var(--warning-text)]" : "bg-[var(--success-soft)] text-[var(--success-text)]"}>
                          {formatCurrency(invoice.balanceAmount)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[var(--muted)]">{formatCurrency(invoice.paidAmount)}</TableCell>
                      <TableCell>{formatDateShort(invoice.issuedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <InvoiceViewLink href={`/admin/invoices/${invoice.id}`} />
                          <InvoiceDownloadButton invoiceId={invoice.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
