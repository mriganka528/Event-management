"use client";

import { useActionState, useState } from "react";
import { CalendarPlus, CheckCircle2, CreditCard, FilePlus2, UserPlus } from "lucide-react";
import type { StaffType } from "@prisma/client";
import { createEventAction, createInvoiceAction, assignStaffAction, recordPaymentAction, updateBookingStatusAction, type ActionState } from "@/lib/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { ActionSubmitButton } from "@/components/forms/action-submit-button";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

const initialState: ActionState = { success: null, error: null };
const BookingStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  PREPARING: "PREPARING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
} as const;
type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];
const PaymentStage = { ADVANCE: "ADVANCE", FINAL: "FINAL" } as const;
const PaymentMethod = { UPI: "UPI", CARD: "CARD", NETBANKING: "NETBANKING", CASH: "CASH" } as const;

type StaffOption = { id: string; name: string; type: StaffType; available: boolean };

function nextStatuses(status: BookingStatus) {
  if (status === BookingStatus.PENDING) return [BookingStatus.APPROVED, BookingStatus.REJECTED, BookingStatus.CANCELLED];
  if (status === BookingStatus.APPROVED) return [BookingStatus.PREPARING, BookingStatus.CANCELLED];
  if (status === BookingStatus.PREPARING) return [BookingStatus.COMPLETED, BookingStatus.CANCELLED];
  return [];
}

export function BookingOperations({
  bookingId,
  status,
  balance,
  eventDate,
  location,
  eventTitle,
  staff,
  assignedStaffIds,
}: {
  bookingId: string;
  status: BookingStatus;
  balance: number;
  eventDate: string;
  location: string;
  eventTitle?: string | null;
  staff: StaffOption[];
  assignedStaffIds: string[];
}) {
  const [paymentKey] = useState(() => `payment_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const [statusState, statusAction] = useActionState(async (_: ActionState, formData: FormData) => updateBookingStatusAction(formData), initialState);
  const [paymentState, paymentAction] = useActionState(async (_: ActionState, formData: FormData) => recordPaymentAction(formData), initialState);
  const [invoiceState, invoiceAction] = useActionState(async (_: ActionState, formData: FormData) => createInvoiceAction(formData), initialState);
  const [eventState, eventAction] = useActionState(async (_: ActionState, formData: FormData) => createEventAction(formData), initialState);
  const [staffState, staffAction] = useActionState(async (_: ActionState, formData: FormData) => assignStaffAction(formData), initialState);
  const transitions = nextStatuses(status);
  const endDate = new Date(new Date(eventDate).getTime() + 8 * 60 * 60 * 1000);

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Booking status</h2><p className="mt-1 text-sm text-[var(--muted)]">Move this request through the operations workflow.</p></div><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-stone-700">{status.toLowerCase()}</span></div>
        {transitions.length > 0 ? <div className="mt-5 flex flex-wrap gap-2">{transitions.map((nextStatus) => <form key={nextStatus} action={statusAction}><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="status" value={nextStatus} /><ActionSubmitButton size="sm" variant={nextStatus === BookingStatus.REJECTED || nextStatus === BookingStatus.CANCELLED ? "outline" : "default"}>{nextStatus === BookingStatus.APPROVED ? <CheckCircle2 className="mr-2 h-4 w-4" /> : null}{nextStatus.charAt(0) + nextStatus.slice(1).toLowerCase()}</ActionSubmitButton></form>)}</div> : <p className="mt-5 rounded-2xl bg-stone-50 p-4 text-sm text-[var(--muted)]">This booking is in a terminal state. No further status changes are available.</p>}
        <div className="mt-4"><ActionFeedback state={statusState} /></div>
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><CreditCard className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Record a payment</h2><p className="mt-1 text-sm text-[var(--muted)]">Outstanding balance: <span className="font-semibold text-[var(--foreground)]">{formatCurrency(balance)}</span></p></div></div>
        {balance > 0 ? <form action={paymentAction} className="mt-5 grid gap-4 sm:grid-cols-2"><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="idempotencyKey" value={paymentKey} /><label className="grid gap-2 text-sm font-medium">Amount<input name="amount" type="number" min="1" step="0.01" max={balance} placeholder="50000" required /></label><label className="grid gap-2 text-sm font-medium">Stage<Select name="stage" options={[{ label: "Advance", value: PaymentStage.ADVANCE }, { label: "Final", value: PaymentStage.FINAL }]} /></label><label className="grid gap-2 text-sm font-medium">Method<Select name="method" options={Object.values(PaymentMethod).map((method) => ({ label: method === PaymentMethod.NETBANKING ? "Net banking" : method.charAt(0) + method.slice(1).toLowerCase(), value: method }))} /></label><label className="grid gap-2 text-sm font-medium sm:col-span-2">Reference <span className="font-normal text-[var(--muted)]">(optional)</span><Input name="reference" placeholder="UPI / cheque / transaction reference" /></label><div className="sm:col-span-2"><SubmitButton>Record payment</SubmitButton></div><div className="sm:col-span-2"><ActionFeedback state={paymentState} /></div></form> : <p className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">This booking is fully paid.</p>}
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-stone-100 p-3 text-stone-700"><FilePlus2 className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Invoice</h2><p className="mt-1 text-sm text-[var(--muted)]">Generate the customer invoice when the booking is ready.</p></div></div><form action={invoiceAction} className="mt-5"><input type="hidden" name="bookingId" value={bookingId} /><SubmitButton variant="outline">Generate invoice</SubmitButton><div className="mt-4"><ActionFeedback state={invoiceState} /></div></form>
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-violet-100 p-3 text-violet-800"><CalendarPlus className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Calendar event</h2><p className="mt-1 text-sm text-[var(--muted)]">Keep the operations calendar in sync with the booking.</p></div></div>
        <form action={eventAction} className="mt-5 grid gap-4"><input type="hidden" name="bookingId" value={bookingId} /><label className="grid gap-2 text-sm font-medium">Event title<input name="title" defaultValue={eventTitle ?? ""} placeholder="Customer · Wedding" required /></label><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Starts<input name="startDate" type="datetime-local" defaultValue={toLocalInput(eventDate)} required /></label><label className="grid gap-2 text-sm font-medium">Ends<input name="endDate" type="datetime-local" defaultValue={toLocalInput(endDate.toISOString())} required /></label></div><label className="grid gap-2 text-sm font-medium">Location<input name="location" defaultValue={location} required /></label><div><SubmitButton>Save event</SubmitButton></div><ActionFeedback state={eventState} /></form>
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-sky-100 p-3 text-sky-800"><UserPlus className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Assign staff</h2><p className="mt-1 text-sm text-[var(--muted)]">Add an available team member to this event.</p></div></div>
        {staff.length > 0 ? <form action={staffAction} className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]"><input type="hidden" name="bookingId" value={bookingId} /><label className="grid gap-2 text-sm font-medium">Team member<Select name="staffId" options={staff.map((member) => ({ label: `${member.name} · ${member.type.toLowerCase().replaceAll("_", " ")}${member.available ? "" : " · unavailable"}`, value: member.id }))} /></label><div className="flex items-end"><SubmitButton><UserPlus className="mr-2 h-4 w-4" />Assign</SubmitButton></div><div className="sm:col-span-2"><ActionFeedback state={staffState} /></div></form> : <p className="mt-5 rounded-2xl bg-stone-50 p-4 text-sm text-[var(--muted)]">Add staff members from the Staff page first.</p>}
        {assignedStaffIds.length > 0 ? <p className="mt-4 text-xs text-[var(--muted)]">{assignedStaffIds.length} team member(s) already assigned to this booking.</p> : null}
      </section>
    </div>
  );
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}
