import Link from "next/link";
import { Download, FilePlus2, Receipt } from "lucide-react";
import { getAdminBookings } from "@/lib/admin-bookings";
import { getAdminInvoices } from "@/lib/admin-data";
import { createInvoiceFormAction } from "@/lib/form-actions";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [invoices, bookingData] = await Promise.all([getAdminInvoices(), getAdminBookings()]);
  const invoiceBookings = new Set(invoices.map((invoice) => invoice.bookingId));
  const missingInvoices = bookingData.bookings.filter((booking) => !invoiceBookings.has(booking.id) && !["PENDING", "CANCELLED", "REJECTED"].includes(booking.status));
  const totalOutstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.balanceAmount), 0);
  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Invoice center</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">A clear paper trail.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Generate and download PDF invoices for approved bookings. Payment balances stay synchronized with the finance desk.</p></section>
      <section className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Issued invoices</p><p className="mt-2 text-3xl font-semibold">{invoices.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Outstanding on invoices</p><p className="mt-2 text-3xl font-semibold">{formatCurrency(totalOutstanding)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Bookings needing invoices</p><p className="mt-2 text-3xl font-semibold">{missingInvoices.length}</p></CardContent></Card></section>
      <Card id="generate-invoice"><CardHeader><CardTitle>Generate an invoice</CardTitle><CardDescription>Choose a booking that does not have an invoice yet.</CardDescription></CardHeader><CardContent>{missingInvoices.length > 0 ? <ActionForm action={createInvoiceFormAction} className="flex flex-col gap-4 sm:flex-row sm:items-end"><label className="grid flex-1 gap-2 text-sm font-medium">Booking<Select name="bookingId" options={missingInvoices.map((booking) => ({ label: `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""} · ${formatCurrency(booking.totalAmount)}`, value: booking.id }))} /></label><SubmitButton><FilePlus2 className="mr-2 h-4 w-4" />Generate invoice</SubmitButton></ActionForm> : <p className="text-sm text-emerald-700">All visible bookings have an invoice.</p>}</CardContent></Card>
      <Card className="overflow-hidden"><CardHeader><CardTitle className="text-2xl">Issued invoices</CardTitle><CardDescription>Download a PDF for customer or internal records.</CardDescription></CardHeader><CardContent className="p-0">{invoices.length === 0 ? <div className="p-6"><EmptyState title="No invoices issued" description="Generate the first invoice from a booking above." /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Event</TableHead><TableHead>Total</TableHead><TableHead>Balance</TableHead><TableHead>Issued</TableHead><TableHead className="text-right">Download</TableHead></TableRow></TableHeader><TableBody>{invoices.map((invoice) => <TableRow key={invoice.id}><TableCell><div className="flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4 text-amber-700" />{invoice.invoiceNumber}</div></TableCell><TableCell>{invoice.booking.customer.user.firstName} {invoice.booking.customer.user.lastName ?? ""}</TableCell><TableCell>{invoice.booking.eventType.toLowerCase()} · {invoice.booking.location}</TableCell><TableCell>{formatCurrency(invoice.totalAmount)}</TableCell><TableCell><Badge className={Number(invoice.balanceAmount) > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>{formatCurrency(invoice.balanceAmount)}</Badge></TableCell><TableCell>{formatDate(invoice.issuedAt)}</TableCell><TableCell className="text-right"><Link href={`/api/invoices/${invoice.id}/download`}><Button size="sm" variant="outline"><Download className="mr-2 h-4 w-4" />PDF</Button></Link></TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    </main>
  );
}
