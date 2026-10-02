import Link from "next/link";
import { BookingStatus, PaymentMethod, PaymentStage, StaffStatus } from "@prisma/client";
import {
  ArrowLeft,
  CalendarRange,
  CreditCard,
  MapPin,
  Receipt,
  ShieldCheck,
  Users,
} from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminBookingById } from "@/lib/admin-bookings";
import { getAdminStaff } from "@/lib/admin-data";
import { unassignStaffFormAction } from "@/lib/form-actions";
import { BookingOperations } from "@/components/admin/booking-operations";
import { ActionForm } from "@/components/forms/action-form";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

function getStatusBadgeClass(status: BookingStatus) {
  switch (status) {
    case BookingStatus.APPROVED:
      return "bg-emerald-100 text-emerald-800";
    case BookingStatus.PREPARING:
      return "bg-blue-100 text-blue-800";
    case BookingStatus.COMPLETED:
      return "bg-stone-900 text-stone-50";
    case BookingStatus.CANCELLED:
    case BookingStatus.REJECTED:
      return "bg-red-100 text-red-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPaymentMethod(method: PaymentMethod) {
  return method === PaymentMethod.NETBANKING ? "Net Banking" : formatEnum(method);
}

function formatPaymentStage(stage: PaymentStage) {
  return formatEnum(stage);
}

export default async function BookingDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const booking = await getAdminBookingById(id);

  if (!booking) {
    notFound();
  }

  const customerName =
    `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""}`.trim();
  const totalReservedInventory = booking.bookingInventory.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const totalAssignedStaff = booking.bookingStaff.length;
  const packageServices = booking.package?.packageServices ?? [];
  const staff = await getAdminStaff();

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-6 shadow-[0_20px_55px_rgba(61,40,14,0.08)] sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(211,138,22,0.18),transparent_28%),linear-gradient(150deg,rgba(255,255,255,0.42),transparent_62%)]" />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin/bookings" className="inline-flex">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to bookings
              </Button>
            </Link>
            <Badge className={getStatusBadgeClass(booking.status)}>{formatEnum(booking.status)}</Badge>
            <Badge className="bg-stone-900 text-stone-50">Booking ID {booking.id.slice(0, 8)}</Badge>
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] sm:text-5xl">
                {customerName}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
                {formatEnum(booking.eventType)} booking at {booking.location} for{" "}
                {booking.guestCount} guests. This page groups event, pricing, payment, inventory,
                staff, and invoice details into a single operational view.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {booking.invoice ? (
                <Link href={`/api/invoices/${booking.invoice.id}/download`}>
                  <Button>
                    <Receipt className="mr-2 h-4 w-4" />
                    Download invoice
                  </Button>
                </Link>
              ) : null}
              <Link href="/admin/payments">
                <Button variant="outline">Payments hub</Button>
              </Link>
              <Link href="/admin/invoices">
                <Button variant="outline">Invoices hub</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Event date",
            value: formatDate(booking.eventDate),
            icon: CalendarRange,
          },
          {
            label: "Total amount",
            value: formatCurrency(booking.totalAmount),
            icon: CreditCard,
          },
          {
            label: "Inventory reserved",
            value: `${totalReservedInventory} items`,
            icon: ShieldCheck,
          },
          {
            label: "Assigned staff",
            value: `${totalAssignedStaff} team members`,
            icon: Users,
          },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="bg-[color:color-mix(in_srgb,var(--card)_92%,transparent)]">
            <CardContent className="flex items-start justify-between gap-4 p-5">
              <div>
                <p className="text-sm text-[var(--muted)]">{label}</p>
                <p className="mt-3 text-xl font-semibold text-[var(--foreground)]">{value}</p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(211,138,22,0.14)] text-[var(--brand-dark)]">
                <Icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <BookingOperations
        bookingId={booking.id}
        status={booking.status}
        balance={Math.max(0, Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount))}
        eventDate={booking.eventDate.toISOString()}
        location={booking.location}
        eventTitle={booking.event?.title}
        staff={staff.filter((member) => member.isAvailable && member.status === StaffStatus.ACTIVE).map((member) => ({
          id: member.id,
          name: `${member.user.firstName} ${member.user.lastName ?? ""}`.trim(),
          type: member.staffType,
          available: member.isAvailable,
        }))}
        assignedStaffIds={booking.bookingStaff.map((assignment) => assignment.staffId)}
      />

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer and event</CardTitle>
              <CardDescription>Primary identity and logistics details for this booking.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4 rounded-[24px] bg-stone-50 p-5">
                <div>
                  <p className="text-sm text-[var(--muted)]">Customer name</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">{customerName}</p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Email</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.customer.user.email}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Phone</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.customer.user.phone ?? "Not provided"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Address</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.customer.address ?? "No customer address saved"}
                  </p>
                </div>
              </div>

              <div className="space-y-4 rounded-[24px] bg-stone-50 p-5">
                <div>
                  <p className="text-sm text-[var(--muted)]">Event type</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {formatEnum(booking.eventType)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Event date</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {formatDate(booking.eventDate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Location</p>
                  <p className="mt-1 flex items-center gap-2 font-medium text-[var(--foreground)]">
                    <MapPin className="h-4 w-4 text-[var(--brand-dark)]" />
                    {booking.location}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Guest count</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.guestCount} guests
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Notes</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.notes?.trim() || "No notes added for this request"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Package and services</CardTitle>
              <CardDescription>
                Package selection plus all individually priced booking services.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="rounded-[24px] border border-stone-100 bg-stone-50 p-5">
                <p className="text-sm text-[var(--muted)]">Selected package</p>
                <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                  {booking.package?.name ?? booking.packageNameSnapshot ?? "Custom service booking"}
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {booking.package?.description ?? "No package was attached to this booking."}
                </p>
              </div>

              {packageServices.length > 0 ? (
                <div className="grid gap-3">
                  <p className="text-sm font-medium text-[var(--foreground)]">Included package services</p>
                  {packageServices.map((item) => (
                    <div
                      key={item.serviceId}
                      className="flex flex-col gap-3 rounded-[20px] border sm:flex-row sm:items-center sm:justify-between border-stone-100 px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{item.service.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {item.service.description ?? "Standard package service"}
                        </p>
                      </div>
                      <Badge>Qty {item.quantity}</Badge>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3">
                <p className="text-sm font-medium text-[var(--foreground)]">Booked service lines</p>
                {booking.bookingServices.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-stone-200 p-4 text-sm text-[var(--muted)]">
                    No service lines are attached to this booking.
                  </div>
                ) : (
                  booking.bookingServices.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-[20px] border border-stone-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{item.service.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          Unit price {formatCurrency(item.unitPrice)} each
                        </p>
                      </div>
                      <div className="text-sm text-right text-[var(--muted)]">
                        <p>Quantity {item.quantity}</p>
                        <p className="font-medium text-[var(--foreground)]">
                          {formatCurrency(item.totalPrice)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments and invoice</CardTitle>
              <CardDescription>
                Financial summary, payment history, and invoice status for settlement tracking.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-4 md:grid-cols-4">
                {[
                  { label: "Subtotal", value: formatCurrency(booking.subtotal) },
                  { label: "Tax", value: formatCurrency(booking.taxAmount) },
                  { label: "Paid", value: formatCurrency(booking.paidAmount) },
                  { label: "Balance", value: formatCurrency(booking.balanceAmount) },
                ].map((item) => (
                  <div key={item.label} className="rounded-[20px] bg-stone-50 p-4">
                    <p className="text-sm text-[var(--muted)]">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-[24px] border border-stone-100 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-[var(--muted)]">Invoice</p>
                    <p className="mt-1 font-medium text-[var(--foreground)]">
                      {booking.invoice?.invoiceNumber ?? "No invoice created yet"}
                    </p>
                  </div>
                  {booking.invoice ? (
                    <Link href={`/api/invoices/${booking.invoice.id}/download`}>
                      <Button size="sm">Download PDF</Button>
                    </Link>
                  ) : (
                    <Badge className="bg-stone-100 text-stone-700">Pending generation</Badge>
                  )}
                </div>
                {booking.invoice ? (
                  <div className="mt-4 grid gap-3 text-sm text-[var(--muted)] md:grid-cols-3">
                    <p>Issued {formatDate(booking.invoice.issuedAt)}</p>
                    <p>Total {formatCurrency(booking.invoice.totalAmount)}</p>
                    <p>Balance {formatCurrency(booking.invoice.balanceAmount)}</p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3">
                <p className="text-sm font-medium text-[var(--foreground)]">Payment history</p>
                {booking.payments.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-stone-200 p-4 text-sm text-[var(--muted)]">
                    No payments have been recorded for this booking yet.
                  </div>
                ) : (
                  booking.payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-col gap-3 rounded-[20px] border border-stone-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {formatCurrency(payment.amount)}
                        </p>
                        <p className="text-sm text-[var(--muted)]">
                          {formatPaymentStage(payment.stage)} via {formatPaymentMethod(payment.method)}
                        </p>
                      </div>
                      <div className="text-right text-sm text-[var(--muted)]">
                        <p>{formatDate(payment.paidAt)}</p>
                        <p>{payment.reference?.trim() || "No reference recorded"}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card className="bg-[linear-gradient(180deg,rgba(37,28,22,0.98),rgba(20,16,12,0.98))] text-white shadow-[0_24px_60px_rgba(28,20,12,0.32)]">
            <CardHeader>
              <CardTitle className="text-white">Operational readiness</CardTitle>
              <CardDescription className="text-white/65">
                A fast summary for inventory, staff, invoice coverage, and calendar connection.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {[
                {
                  label: "Booking status",
                  value: formatEnum(booking.status),
                },
                {
                  label: "Inventory lines",
                  value: `${booking.bookingInventory.length} reserved categories`,
                },
                {
                  label: "Team assignment",
                  value:
                    totalAssignedStaff > 0
                      ? `${totalAssignedStaff} members assigned`
                      : "No staff assigned yet",
                },
                {
                  label: "Calendar event",
                  value: booking.event ? "Linked to event calendar" : "No event record yet",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-[22px] border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-white/60">{item.label}</p>
                  <p className="mt-2 font-medium text-white">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory allocation</CardTitle>
              <CardDescription>
                Reserved stock attached to this booking and any low-availability signals.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {booking.bookingInventory.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-stone-200 p-4 text-sm text-[var(--muted)]">
                  No inventory has been reserved for this booking yet.
                </div>
              ) : (
                booking.bookingInventory.map((item) => {
                  const isLow = item.inventory.availableQuantity <= item.inventory.reorderLevel;

                  return (
                    <div
                      key={item.id}
                      className="rounded-[20px] border border-stone-100 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--foreground)]">
                            {item.inventory.name}
                          </p>
                          <p className="text-sm text-[var(--muted)]">
                            {formatEnum(item.inventory.category)}
                          </p>
                        </div>
                        <Badge className={cn(isLow && "bg-red-100 text-red-800")}>
                          Reserved {item.quantity}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        Available now {item.inventory.availableQuantity} of{" "}
                        {item.inventory.totalQuantity}
                        {isLow ? " • below reorder threshold" : ""}
                      </p>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Staff assignment</CardTitle>
              <CardDescription>Assigned team members and their current role for the booking.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {booking.bookingStaff.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-stone-200 p-4 text-sm text-[var(--muted)]">
                  No staff members have been attached to this booking yet.
                </div>
              ) : (
                booking.bookingStaff.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="rounded-[20px] border border-stone-100 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {assignment.staff.user.firstName} {assignment.staff.user.lastName ?? ""}
                        </p>
                        <p className="text-sm text-[var(--muted)]">
                          {formatEnum(assignment.staff.staffType)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2"><Badge>{formatDate(assignment.assignedAt)}</Badge><ActionForm action={unassignStaffFormAction}><input type="hidden" name="bookingId" value={booking.id} /><input type="hidden" name="assignmentId" value={assignment.id} /><Button type="submit" size="sm" variant="outline">Remove</Button></ActionForm></div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Calendar and audit</CardTitle>
              <CardDescription>Timeline and system metadata linked to this booking record.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="rounded-[20px] bg-stone-50 p-4">
                <p className="text-[var(--muted)]">Calendar event</p>
                <p className="mt-1 font-medium text-[var(--foreground)]">
                  {booking.event?.title ?? "No event created yet"}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {booking.event
                    ? `${formatDate(booking.event.startDate)} to ${formatDate(booking.event.endDate)}`
                    : "Create an event record when operations planning begins."}
                </p>
              </div>
              <div className="rounded-[20px] bg-stone-50 p-4">
                <p className="text-[var(--muted)]">Record timestamps</p>
                <p className="mt-1 text-[var(--foreground)]">Created {formatDate(booking.createdAt)}</p>
                <p className="mt-1 text-[var(--foreground)]">Updated {formatDate(booking.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
