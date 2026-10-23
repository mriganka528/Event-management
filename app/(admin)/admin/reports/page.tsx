import Link from "next/link";
import type { Metadata } from "next";
import { BarChart3, Download, IndianRupee, PieChart, TrendingUp } from "lucide-react";
import { getAdminReports } from "@/lib/admin-data";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reports",
  description: "Revenue, outstanding balances, and booking mix by event type and payment method.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ReportsPage() {
  const report = await getAdminReports();
  const maxType = Math.max(...report.byType.map((item) => item.revenue), 1);
  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Business intelligence</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">See the story in the numbers.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">A practical snapshot of event demand, collections, and booking performance.</p></div><Link href="/api/admin/reports/export" className="inline-flex h-11 items-center justify-center rounded-full border border-stone-300 px-5 text-sm font-medium text-stone-800 hover:bg-stone-50"><Download className="mr-2 h-4 w-4" />Export report</Link></section>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Total bookings</p><p className="mt-2 text-3xl font-semibold">{report.totals.bookings}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Booked value</p><p className="mt-2 text-3xl font-semibold">{formatCurrency(report.totals.revenue)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Collected</p><p className="mt-2 text-3xl font-semibold text-emerald-700">{formatCurrency(report.totals.collected)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Outstanding</p><p className="mt-2 text-3xl font-semibold text-amber-800">{formatCurrency(report.totals.outstanding)}</p></CardContent></Card></section>
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]"><Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-amber-700" />Revenue by event type</CardTitle><CardDescription>Booked value across the portfolio.</CardDescription></CardHeader><CardContent>{report.byType.length === 0 ? <p className="text-sm text-[var(--muted)]">No booking data yet.</p> : <div className="grid gap-4">{report.byType.map((item) => <div key={item.eventType}><div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium capitalize">{item.eventType.toLowerCase()}</span><span className="text-[var(--muted)]">{formatCurrency(item.revenue)} · {item.count} booking(s)</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300" style={{ width: `${(item.revenue / maxType) * 100}%` }} /></div></div>)}</div>}</CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><PieChart className="h-5 w-5 text-amber-700" />Booking pipeline</CardTitle><CardDescription>Current status distribution.</CardDescription></CardHeader><CardContent><div className="grid gap-3">{report.byStatus.map((item) => <div key={item.status} className="flex items-center justify-between rounded-2xl bg-stone-50 p-3"><span className="text-sm font-medium capitalize">{item.status.toLowerCase()}</span><span className="rounded-full bg-white px-3 py-1 text-sm font-semibold">{item.count}</span></div>)}</div></CardContent></Card></section>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-amber-700" />Collections by payment method</CardTitle></CardHeader><CardContent>{report.byMethod.length === 0 ? <p className="text-sm text-[var(--muted)]">No payments recorded yet.</p> : <div className="grid gap-4 md:grid-cols-3">{report.byMethod.map((item) => <div key={item.method} className="rounded-2xl bg-stone-50 p-4"><div className="flex items-center gap-2 text-sm text-[var(--muted)]"><IndianRupee className="h-4 w-4" />{item.method === "NETBANKING" ? "Net banking" : item.method.toLowerCase()}</div><p className="mt-2 text-xl font-semibold">{formatCurrency(item.amount)}</p></div>)}</div>}</CardContent></Card>
    </main>
  );
}
