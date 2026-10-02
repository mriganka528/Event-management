import { Mail, MapPin, Phone } from "lucide-react";
import { getAdminCustomers } from "@/lib/admin-data";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await getAdminCustomers();
  const lifetimeValue = customers.reduce((sum, customer) => sum + customer.bookings.reduce((customerSum, booking) => customerSum + Number(booking.totalAmount), 0), 0);
  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Customer relationships</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">People who trust you.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">A single view of customer contact details, booking history, and event value.</p></section>
      <section className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Customers</p><p className="mt-2 text-3xl font-semibold">{customers.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Booked value</p><p className="mt-2 text-3xl font-semibold">{formatCurrency(lifetimeValue)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Repeat customers</p><p className="mt-2 text-3xl font-semibold">{customers.filter((customer) => customer.bookings.length > 1).length}</p></CardContent></Card></section>
      <Card><CardHeader><CardTitle className="text-2xl">Customer directory</CardTitle><CardDescription>Contact details and latest booking context.</CardDescription></CardHeader><CardContent>{customers.length === 0 ? <EmptyState title="No customers yet" description="Public booking requests will create customer profiles here." /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{customers.map((customer) => <div key={customer.id} className="rounded-2xl border border-stone-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-800">{customer.user.firstName.charAt(0)}{customer.user.lastName?.charAt(0) ?? ""}</span><div><p className="font-semibold">{customer.user.firstName} {customer.user.lastName ?? ""}</p><p className="text-sm text-[var(--muted)]">Joined {formatDate(customer.createdAt)}</p></div></div><Badge>{customer.bookings.length} booking(s)</Badge></div><div className="mt-5 grid gap-2 text-sm text-[var(--muted)]"><p className="flex items-center gap-2"><Mail className="h-4 w-4" />{customer.user.email}</p><p className="flex items-center gap-2"><Phone className="h-4 w-4" />{customer.user.phone ?? "No phone saved"}</p><p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{customer.address ?? "No address saved"}</p></div>{customer.bookings[0] ? <div className="mt-5 rounded-xl bg-stone-50 p-3 text-sm"><p className="font-medium">Latest event</p><p className="mt-1 text-[var(--muted)]">{customer.bookings[0].eventType.toLowerCase()} · {formatDate(customer.bookings[0].eventDate)}</p></div> : null}</div>)}</div>}</CardContent></Card>
    </main>
  );
}
