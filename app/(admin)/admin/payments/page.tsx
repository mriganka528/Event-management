import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { IndianRupee } from "lucide-react";
import { getAdminBookings } from "@/lib/admin-bookings";
import { getAdminPaymentOrders, getAdminPayments, getPendingCashPayments } from "@/lib/admin-data";
import { AdminSearch } from "@/components/admin/admin-search";
import { ManualPaymentForm } from "@/components/admin/manual-payment-form";
import { PendingCashApprovals } from "@/components/admin/pending-cash-approvals";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/forms/empty-state";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payments",
  description: "Record a payment against a booking balance and review captured payments.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const [payments, paymentOrders, bookingData, pendingCash] = await Promise.all([getAdminPayments(), getAdminPaymentOrders(), getAdminBookings(), getPendingCashPayments()]);
  // Rows stay in the DOM and non-matching ones are hidden, so the browser can
  // reveal them again without a request. The booking picker is not filtered:
  // it is a form control, not a list to search.
  const visibility = rowFilter(query);
  const paymentText = (payment: (typeof payments)[number]) =>
    rowText(
      payment.id,
      payment.reference,
      payment.method,
      payment.stage,
      payment.status,
      payment.booking.customer.user.firstName,
      payment.booking.customer.user.lastName,
      payment.booking.customer.user.email,
    );
  const collected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const openBookings = bookingData.bookings.filter((booking) => Number(booking.balanceAmount) > Number(booking.reservedPaymentAmount) && ["APPROVED", "PREPARING", "COMPLETED"].includes(booking.status));
  const manualBookings = openBookings.map((booking) => ({
    id: booking.id,
    label: `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""} · ${formatCurrency(Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount))} available`,
    totalAmount: Number(booking.totalAmount),
    paidAmount: Number(booking.paidAmount),
    availableBalance: Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount),
  }));
  const pendingCashClaims = pendingCash.map((payment) => ({
    id: payment.id,
    bookingId: payment.booking.id,
    amount: Number(payment.amount),
    createdAt: payment.createdAt,
    customerName: `${payment.booking.customer.user.firstName} ${payment.booking.customer.user.lastName ?? ""}`.trim(),
    bookingLocation: payment.booking.location,
    balance: Number(payment.booking.balanceAmount),
  }));

  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search payments"
        placeholder="Search by reference, customer, method, or booking…"
      />
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Finance desk</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Payments, without the guesswork.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Razorpay online payments and administrator-recorded payments appear in one settled ledger. Pending checkout attempts never count as revenue.</p></section>
      <section className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-[var(--muted)]">Total collected</p><p className="mt-2 text-3xl font-semibold">{formatCurrency(collected)}</p></div><span className="rounded-2xl bg-[var(--success-soft)] p-3 text-[var(--success-text)]"><IndianRupee className="h-5 w-5" /></span></div></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Captured payments</p><p className="mt-2 text-3xl font-semibold">{payments.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Open balances</p><p className="mt-2 text-3xl font-semibold">{openBookings.length}</p></CardContent></Card></section>
      <PendingCashApprovals claims={pendingCashClaims} />
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><Card id="record-payment"><CardHeader><CardTitle>Record a manual payment</CardTitle><CardDescription>Use this for cash, bank transfer, or a payment collected outside Razorpay.</CardDescription></CardHeader><CardContent>{openBookings.length > 0 ? <ManualPaymentForm key={manualBookings.map((booking) => `${booking.id}:${booking.availableBalance}`).join("|")} bookings={manualBookings} idempotencyKey={`manual-${randomUUID()}`} /> : <EmptyState title="No open balances" description="Every visible booking is fully paid or has an active online checkout." />}</CardContent></Card><Card className="overflow-hidden"><CardHeader><CardTitle className="text-2xl">Captured payment history</CardTitle><CardDescription>Only captured/manual payments are included.</CardDescription></CardHeader><CardContent className="p-0">{payments.length === 0 ? <div className="p-6"><EmptyState title="No payments recorded" description="Captured Razorpay and manual payments will appear here." /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Amount</TableHead><TableHead>Source</TableHead><TableHead>Method</TableHead><TableHead>Paid</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader><TableBody>{payments.map((payment) => <TableRow key={payment.id} data-row-id={payment.id} data-row-text={paymentText(payment)} style={visibility(paymentText(payment))}><TableCell><p className="font-semibold">{payment.booking.customer.user.firstName} {payment.booking.customer.user.lastName ?? ""}</p><p className="text-sm text-stone-500">{payment.booking.eventType.toLowerCase()}</p></TableCell><TableCell className="font-semibold">{formatCurrency(payment.amount)}</TableCell><TableCell><Badge className={payment.provider === "RAZORPAY" ? "bg-blue-100 text-blue-800" : "bg-stone-100 text-stone-700"}>{payment.provider === "RAZORPAY" ? "Razorpay" : "Manual"}</Badge></TableCell><TableCell>{payment.method.toLowerCase()}</TableCell><TableCell>{formatDate(payment.paidAt)}</TableCell><TableCell className="max-w-48 truncate text-xs">{payment.providerPaymentId ?? payment.reference ?? "—"}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card></div>
      <Card><CardHeader><CardTitle className="text-2xl">Razorpay attempts</CardTitle><CardDescription>Open and completed online checkout attempts, including webhook state.</CardDescription></CardHeader><CardContent className="p-0">{paymentOrders.length === 0 ? <div className="p-6"><EmptyState title="No online attempts" description="Razorpay checkout attempts will appear here." /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Provider order</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{paymentOrders.map((order) => <TableRow key={order.id}><TableCell>{order.booking.customer.user.firstName} {order.booking.customer.user.lastName ?? ""}</TableCell><TableCell>{formatCurrency(order.amount)}</TableCell><TableCell><Badge className={order.status === "PAID" ? "bg-[var(--success-soft)] text-[var(--success-text)]" : order.status === "FAILED" ? "bg-[var(--danger-soft)] text-[var(--danger-text)]" : "bg-[var(--warning-soft)] text-[var(--warning-text)]"}>{order.status.toLowerCase()}</Badge></TableCell><TableCell className="max-w-56 truncate text-xs">{order.providerOrderId ?? "Pending provider order"}</TableCell><TableCell>{formatDate(order.createdAt)}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    </main>
  );
}
