"use client";

import { useActionState, useState } from "react";
import { CalendarPlus, CheckCircle2, CreditCard, FilePlus2, HandCoins, LockKeyhole, UserPlus, X } from "lucide-react";
import type { PaymentRequestMode, StaffType } from "@prisma/client";
import { createEventAction, createInvoiceAction, clearPaymentRequestAction, requestPaymentAction, assignStaffAction, unassignStaffAction, recordPaymentAction, updateBookingStatusAction, type ActionState } from "@/lib/actions";
import { advancePaymentPreset, PAYMENT_REQUEST_LABEL, paymentPresets, paymentRequestOutstanding } from "@/lib/payment-requests";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoiceViewLink } from "@/components/invoices/invoice-view-link";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { ActionSubmitButton } from "@/components/forms/action-submit-button";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { toIstLocalInput } from "@/lib/ist";

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

/** A staff member already on the roster for this event. */
type AssignedStaff = { assignmentId: string; id: string; name: string; type: StaffType; assignedAt: string };

function nextStatuses(status: BookingStatus) {
  if (status === BookingStatus.PENDING) return [BookingStatus.APPROVED, BookingStatus.REJECTED, BookingStatus.CANCELLED];
  if (status === BookingStatus.APPROVED) return [BookingStatus.PREPARING, BookingStatus.CANCELLED];
  if (status === BookingStatus.PREPARING) return [BookingStatus.COMPLETED, BookingStatus.CANCELLED];
  return [];
}

function LockedNotice({ message }: { message: string }) {
  return (
    <p className="mt-5 flex items-start gap-2 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function BookingOperations({
  bookingId,
  status,
  balance,
  paidAmount,
  totalAmount,
  paymentRequestMode,
  paymentRequestTargetAmount,
  invoiceId,
  invoiceNumber,
  eventDate,
  location,
  eventTitle,
  staff,
  assignedStaff,
  teamReleased = false,
}: {
  bookingId: string;
  status: BookingStatus;
  balance: number;
  paidAmount: number;
  totalAmount: number;
  paymentRequestMode: PaymentRequestMode | null;
  paymentRequestTargetAmount: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  eventDate: string;
  location: string;
  eventTitle?: string | null;
  staff: StaffOption[];
  /** Who is already on this event's roster. */
  assignedStaff: AssignedStaff[];
  /**
   * Whether the event is over, so the team has been released.
   *
   * The roster is then a record of who worked it rather than a list of people
   * still to be booked, and the buttons that would change it are not offered.
   */
  teamReleased?: boolean;
}) {
  const [paymentKey] = useState(() => `payment_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentStage, setPaymentStage] = useState("ADVANCE");
  const [statusState, statusAction] = useActionState(async (_: ActionState, formData: FormData) => updateBookingStatusAction(formData), initialState);
  const [requestState, requestAction] = useActionState(async (_: ActionState, formData: FormData) => requestPaymentAction(formData), initialState);
  const [clearState, clearAction] = useActionState(async (_: ActionState, formData: FormData) => clearPaymentRequestAction(formData), initialState);
  const [paymentState, paymentAction] = useActionState(async (_: ActionState, formData: FormData) => {
    const result = await recordPaymentAction(formData);
    // A successful payment changes the balance; leaving the old figure in the
    // box invites a second, accidental record of the same amount.
    if (result.success) {
      setPaymentAmount("");
      setPaymentStage("ADVANCE");
    }
    return result;
  }, initialState);
  const [invoiceState, invoiceAction] = useActionState(async (_: ActionState, formData: FormData) => createInvoiceAction(formData), initialState);
  const [eventState, eventAction] = useActionState(async (_: ActionState, formData: FormData) => createEventAction(formData), initialState);
  const [staffState, staffAction] = useActionState(async (_: ActionState, formData: FormData) => assignStaffAction(formData), initialState);
  const [unassignState, unassignAction] = useActionState(async (_: ActionState, formData: FormData) => unassignStaffAction(formData), initialState);
  const transitions = nextStatuses(status);
  /*
   * Who can still be put on this event.
   *
   * Anybody already on the roster is filtered out, so the drop-down cannot
   * offer a second assignment for the same person. The server refuses it too,
   * but a refusal at the last step is a worse experience than never offering
   * the choice.
   */
  const alreadyAssigned = new Set(assignedStaff.map((member) => member.id));
  const assignableStaff = staff.filter((member) => !alreadyAssigned.has(member.id));
  const endDate = new Date(new Date(eventDate).getTime() + 8 * 60 * 60 * 1000);
  const requestedDue = paymentRequestOutstanding({
    paymentRequestTargetAmount,
    paidAmount,
    balanceAmount: balance,
  });
  const canRequestPayment = ["APPROVED", "PREPARING", "COMPLETED"].includes(status) && balance > 0;
  const operationsLocked = status === BookingStatus.CANCELLED || status === BookingStatus.REJECTED;
  const presets = paymentPresets({ totalAmount, paidAmount, balanceAmount: balance });
  const advancePreset = advancePaymentPreset({ totalAmount, balanceAmount: balance });
  // `paymentPresets` describes cumulative targets, so it drops the 25% button
  // after the first advance. The record-payment form keeps offering a 25% of
  // total instalment, capped at the live balance, for a second advance.
  const presetsToShow = advancePreset && !presets.some((preset) => preset.key === "ADVANCE")
    ? [advancePreset, ...presets.filter((preset) => Math.abs(preset.amount - advancePreset.amount) >= 0.01)]
    : presets;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {operationsLocked ? (
        <div role="status" className="flex items-start gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--warning-soft)] p-5 text-sm text-[var(--warning-text)] xl:col-span-2">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Operational changes are locked.</p>
            <p className="mt-1">
              This booking was {status === BookingStatus.CANCELLED ? "cancelled" : "declined"}. Staff assignments, payments, new payment requests, calendar events, and invoice generation are disabled. Existing records and invoices remain available.
            </p>
          </div>
        </div>
      ) : null}
      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Booking status</h2><p className="mt-1 text-sm text-[var(--muted)]">Move this request through the operations workflow.</p></div><span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">{status.toLowerCase()}</span></div>
        {transitions.length > 0 ? <div className="mt-5 flex flex-wrap gap-2">{transitions.map((nextStatus) => <form key={nextStatus} action={statusAction}><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="status" value={nextStatus} /><ActionSubmitButton size="sm" variant={nextStatus === BookingStatus.REJECTED || nextStatus === BookingStatus.CANCELLED ? "outline" : "default"}>{nextStatus === BookingStatus.APPROVED ? <CheckCircle2 className="mr-2 h-4 w-4" /> : null}{nextStatus.charAt(0) + nextStatus.slice(1).toLowerCase()}</ActionSubmitButton></form>)}</div> : <p className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">This booking is in a terminal state. No further status changes are available.</p>}
        <div className="mt-4"><ActionFeedback state={statusState} /></div>
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-[var(--brand-soft)] p-3 text-[var(--brand-dark)]"><HandCoins className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Request a payment</h2><p className="mt-1 text-sm text-[var(--muted)]">Ask the customer for a 25% advance, half of the remaining balance, or the full balance. They can pay the requested amount or settle everything at once.</p></div></div>
        {requestedDue !== null && paymentRequestMode ? (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--brand-softer)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">{PAYMENT_REQUEST_LABEL[paymentRequestMode]} requested</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Outstanding on that request: <span className="font-semibold text-[var(--foreground)]">{formatCurrency(requestedDue)}</span></p>
            </div>
            {operationsLocked ? (
              <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Closed</span>
            ) : (
              <form action={clearAction}>
                <input type="hidden" name="bookingId" value={bookingId} />
                <SubmitButton size="sm" variant="outline"><X className="mr-2 h-4 w-4" />Withdraw</SubmitButton>
              </form>
            )}
          </div>
        ) : null}
        {operationsLocked ? (
          <LockedNotice message="Payment requests are closed for this booking." />
        ) : canRequestPayment ? (
          <form action={requestAction} className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="bookingId" value={bookingId} />
            <label className="grid gap-2 text-sm font-medium">Amount to request
              <Select name="mode" defaultValue="ADVANCE" options={[{ label: "Advance · 25% of total", value: "ADVANCE" }, { label: "Half · 50% of balance", value: "HALF" }, { label: "Full · remaining balance", value: "FULL" }]} />
            </label>
            <SubmitButton><HandCoins className="mr-2 h-4 w-4" />Send request</SubmitButton>
            <div className="sm:col-span-2"><ActionFeedback state={requestState} /></div>
            {clearState.success || clearState.error ? <div className="sm:col-span-2"><ActionFeedback state={clearState} /></div> : null}
          </form>
        ) : <p className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">{balance <= 0 ? "The booking is fully paid, so there is nothing to request." : "Approve the booking before requesting a payment."}</p>}
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-[var(--brand-soft)] p-3 text-[var(--brand-dark)]"><CreditCard className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Record a payment</h2><p className="mt-1 text-sm text-[var(--muted)]">Outstanding balance: <span className="font-semibold text-[var(--foreground)]">{formatCurrency(balance)}</span></p></div></div>
        {operationsLocked ? <LockedNotice message="Payments cannot be recorded on a cancelled or declined booking." /> : balance > 0 ? <form action={paymentAction} className="mt-5 grid gap-4 sm:grid-cols-2"><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="idempotencyKey" value={paymentKey} /><div className="flex flex-wrap gap-2 sm:col-span-2"><span className="text-sm font-medium">Quick fill</span>{presetsToShow.map((preset) => <Button key={preset.key} type="button" size="sm" variant="outline" onClick={() => { setPaymentAmount(String(preset.amount)); setPaymentStage(preset.stage); }}>{preset.label} · {formatCurrency(preset.amount)}</Button>)}</div><label className="grid gap-2 text-sm font-medium">Amount<input name="amount" type="number" min="0.01" step="0.01" max={balance} placeholder="50000" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label><label className="grid gap-2 text-sm font-medium">Stage<Select name="stage" value={paymentStage} onChange={(event) => setPaymentStage(event.target.value)} options={[{ label: "Advance / part payment", value: PaymentStage.ADVANCE }, { label: "Final settlement", value: PaymentStage.FINAL }]} /></label><label className="grid gap-2 text-sm font-medium">Method<Select name="method" options={Object.values(PaymentMethod).map((method) => ({ label: method === PaymentMethod.NETBANKING ? "Net banking" : method.charAt(0) + method.slice(1).toLowerCase(), value: method }))} /></label><label className="grid gap-2 text-sm font-medium sm:col-span-2">Reference <span className="font-normal text-[var(--muted)]">(optional)</span><Input name="reference" placeholder="UPI / cheque / transaction reference" /></label><div className="sm:col-span-2"><SubmitButton>Record payment</SubmitButton></div><div className="sm:col-span-2"><ActionFeedback state={paymentState} /></div></form> : <p className="mt-5 rounded-2xl bg-[var(--success-soft)] p-4 text-sm text-[var(--success-text)]">This booking is fully paid.</p>}
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-[var(--surface-strong)] p-3 text-[var(--foreground)]"><FilePlus2 className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Invoice</h2><p className="mt-1 text-sm text-[var(--muted)]">{invoiceId ? `${invoiceNumber ?? "Invoice"} is ready to view or download.` : "Generate the customer invoice when the booking is ready."}</p></div></div>
        {invoiceId ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <InvoiceViewLink href={`/admin/invoices/${invoiceId}`} variant="default" size="default" />
            <InvoiceDownloadButton invoiceId={invoiceId} />
          </div>
        ) : operationsLocked ? (
          <LockedNotice message="Invoices cannot be generated for a cancelled or declined booking." />
        ) : (
          <form action={invoiceAction} className="mt-5"><input type="hidden" name="bookingId" value={bookingId} /><SubmitButton variant="outline">Generate invoice</SubmitButton><div className="mt-4"><ActionFeedback state={invoiceState} /></div></form>
        )}
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-violet-100 p-3 text-violet-800"><CalendarPlus className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Calendar event</h2><p className="mt-1 text-sm text-[var(--muted)]">Keep the operations calendar in sync with the booking.</p></div></div>
        {operationsLocked ? (
          <LockedNotice message="Calendar events are locked for this booking." />
        ) : (
          <form action={eventAction} className="mt-5 grid gap-4"><input type="hidden" name="bookingId" value={bookingId} /><label className="grid gap-2 text-sm font-medium">Event title<input name="title" defaultValue={eventTitle ?? ""} placeholder="Customer · Wedding" required /></label><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Starts<input name="startDate" type="datetime-local" defaultValue={toLocalInput(eventDate)} required /></label><label className="grid gap-2 text-sm font-medium">Ends<input name="endDate" type="datetime-local" defaultValue={toLocalInput(endDate.toISOString())} required /></label></div><label className="grid gap-2 text-sm font-medium">Location<input name="location" defaultValue={location} required /></label><div><SubmitButton>Save event</SubmitButton></div><ActionFeedback state={eventState} /></form>
        )}
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-sky-100 p-3 text-sky-800"><UserPlus className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">Assign staff</h2><p className="mt-1 text-sm text-[var(--muted)]">Add an available team member to this event.</p></div></div>

        {/*
          The roster, in the same place as the control that changes it.

          It used to sit in a separate card further down the page, so the
          person assigning somebody had to scroll away to find out who was
          already on the event — and the only sign of it here was a count.
        */}
        {assignedStaff.length > 0 ? (
          <div className="mt-5">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              On this event ({assignedStaff.length})
            </p>
            <ul className="mt-3 grid gap-2">
              {assignedStaff.map((member) => (
                <li
                  key={member.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-[var(--foreground)]">{member.name}</p>
                    <p className="text-sm capitalize text-[var(--muted)]">
                      {member.type.toLowerCase().replaceAll("_", " ")}
                    </p>
                  </div>
                  {/*
                    The Remove button is only offered while the team is still
                    booked. Once the event is over the row is a record of who
                    worked it, and a button for un-assigning somebody from
                    work that has already happened would erase that record.
                  */}
                  {teamReleased ? (
                    <Badge className="shrink-0 bg-[var(--surface-strong)] text-[var(--muted)]">Released</Badge>
                  ) : operationsLocked ? (
                    <Badge className="shrink-0 bg-[var(--surface-strong)] text-[var(--muted)]">Locked</Badge>
                  ) : (
                    <form action={unassignAction} className="shrink-0">
                      <input type="hidden" name="bookingId" value={bookingId} />
                      <input type="hidden" name="assignmentId" value={member.assignmentId} />
                      <SubmitButton size="sm" variant="outline">Remove</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {operationsLocked ? (
          <LockedNotice message="Staff assignments are locked for this booking." />
        ) : teamReleased ? (
          <p className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
            This event is over, so its team has been released. The people on it are free for other events and the roster above is kept as a record of who worked it.
          </p>
        ) : assignableStaff.length > 0 ? (
          <form action={staffAction} className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
            <input type="hidden" name="bookingId" value={bookingId} />
            <label className="grid gap-2 text-sm font-medium">Team member
              {/*
                Anybody already on the roster is left out of the list. Offering
                them meant the drop-down invited a second assignment, which the
                server then refused — so the failure happened at the last step
                instead of at the point of choosing.
              */}
              <Select
                name="staffId"
                options={assignableStaff.map((member) => ({
                  label: `${member.name} · ${member.type.toLowerCase().replaceAll("_", " ")}${member.available ? "" : " · unavailable"}`,
                  value: member.id,
                }))}
              />
            </label>
            <div className="flex items-end"><SubmitButton><UserPlus className="mr-2 h-4 w-4" />Assign</SubmitButton></div>
            <div className="sm:col-span-2"><ActionFeedback state={staffState} /></div>
          </form>
        ) : staff.length === 0 ? (
          <p className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">Add staff members from the Staff page first.</p>
        ) : (
          <p className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
            Every available team member is already on this event. Remove somebody above to assign a different person.
          </p>
        )}
        {unassignState.success || unassignState.error ? (
          <div className="mt-4"><ActionFeedback state={unassignState} /></div>
        ) : null}
      </section>
    </div>
  );
}

function toLocalInput(value: string) {
  // The `datetime-local` field has no timezone, so it shows and reads wall
  // clock time. The business works in IST, so that is the wall clock it
  // shows — the server's own offset would put the saved time five and a half
  // hours out. See `lib/ist.ts`.
  return toIstLocalInput(value);
}
