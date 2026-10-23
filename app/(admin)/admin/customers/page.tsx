import { Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { RoleKey } from "@prisma/client";
import { getAdminCustomers } from "@/lib/admin-data";
import { requireAdminPage } from "@/lib/route-guards";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AdminSearch } from "@/components/admin/admin-search";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { RemoveCustomerButton } from "./remove-customer-button";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Customers",
  description: "Customer accounts, their contact details, and their booking history.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const viewer = await requireAdminPage();
  const customers = await getAdminCustomers();
  // Rows stay in the DOM and non-matching ones are hidden, so clearing the
  // search brings them straight back with no server round trip.
  const visibility = rowFilter(query);
  const customerText = (customer: (typeof customers)[number]) =>
    rowText(customer.user.firstName, customer.user.lastName, customer.user.email, customer.user.phone);
  const isSuperAdmin = viewer.role === RoleKey.SUPER_ADMIN;
  const lifetimeValue = customers.reduce((sum, customer) => sum + customer.bookings.reduce((customerSum, booking) => customerSum + Number(booking.totalAmount), 0), 0);
  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search customers"
        placeholder="Search by name, email address, or phone…"
      />
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Customer relationships</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">People who trust you.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">A single view of customer contact details, booking history, and event value.</p></section>
      <section className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Customers</p><p className="mt-2 text-3xl font-semibold">{customers.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Booked value</p><p className="mt-2 text-3xl font-semibold">{formatCurrency(lifetimeValue)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Repeat customers</p><p className="mt-2 text-3xl font-semibold">{customers.filter((customer) => customer.bookings.length > 1).length}</p></CardContent></Card></section>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Customer directory</CardTitle>
          <CardDescription>
            Contact details and latest booking context.
            {isSuperAdmin ? " Removing a customer erases their personal details for good and signs them out everywhere — their bookings, payments, and invoices stay in the history and keep counting towards revenue." : " Only a super admin can remove a customer record."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <EmptyState title="No customers yet" description="Public booking requests will create customer profiles here." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {customers.map((customer) => {
                const name = customer.isErased
                  ? "Removed customer"
                  : `${customer.user.firstName} ${customer.user.lastName ?? ""}`.trim() || customer.user.email;
                return (
                  <div key={customer.id} data-row-id={customer.id} data-row-text={customerText(customer)} style={visibility(customerText(customer))} className="flex flex-col rounded-2xl border border-stone-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-800">{customer.isErased ? "–" : customer.user.firstName.charAt(0)}</span>
                        <div className="min-w-0">
                          <p className="break-words font-semibold">{name}</p>
                          <p className="text-sm text-[var(--muted)]">Joined {formatDate(customer.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {customer.isErased ? (
                          <Badge className="bg-[var(--surface-strong)] text-[var(--muted-strong)]"><ShieldCheck className="mr-1 h-3 w-3" />Details removed</Badge>
                        ) : null}
                        <Badge>{customer.bookings.length} booking(s)</Badge>
                      </div>
                    </div>

                    {/*
                      Each value gets its own element with `min-w-0`.
                      `{customer.user.email}` written straight into a `flex` row
                      becomes an *anonymous* flex item, which is `min-width: auto`
                      and so refuses to shrink below its content — and an email
                      address has no spaces to break on. The result ran out through
                      the side of the card on a narrow screen. The icon needs
                      `shrink-0` for the same reason in reverse: without it the
                      letter box is what gets squeezed instead.
                    */}
                    <div className="mt-5 grid flex-1 gap-2 text-sm text-[var(--muted)]">
                      <p className="flex items-start gap-2">
                        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 break-all">{customer.user.email}</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Phone className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 break-words">{customer.user.phone ?? "No phone saved"}</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 break-words">{customer.address ?? "No address saved"}</span>
                      </p>
                    </div>

                    {customer.bookings[0] ? (
                      <div className="mt-5 rounded-xl bg-stone-50 p-3 text-sm">
                        <p className="font-medium">Latest event</p>
                        <p className="mt-1 text-[var(--muted)]">{customer.bookings[0].eventType.toLowerCase()} · {formatDate(customer.bookings[0].eventDate)}</p>
                      </div>
                    ) : null}

                    {isSuperAdmin && !customer.isErased ? (
                      <div className="mt-4 flex justify-end border-t border-stone-200 pt-3">
                        <RemoveCustomerButton
                          customerId={customer.id}
                          name={name}
                          bookings={customer.bookings.length}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}