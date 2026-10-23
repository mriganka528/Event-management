"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { toast } from "react-hot-toast";
import { Check, CircleHelp, Minus, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { createBookingAction, type ActionState } from "@/lib/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { SuggestedInput } from "@/components/ui/suggested-input";
import { EVENT_LOCATION_SUGGESTIONS } from "@/lib/suggestions";
import { formatInventoryCategory, applyQuantityStep, type CapacityView } from "@/lib/inventory";
import { eventDayCount, MAX_EVENT_DAYS } from "@/lib/event-dates";
import { istTodayKey } from "@/lib/ist";

type CatalogService = {
  id: string;
  name: string;
  slug: string;
  basePrice: number | string;
  unitLabel: string;
  pricingMode?: "FIXED" | "PER_GUEST" | "PER_DAY";
  /** Every stock category the service draws one unit of, per unit of itself. */
  inventoryCategories?: string[] | null;
};

type CatalogPackage = {
  id: string;
  name: string;
  description: string;
  price: number | string;
  imageUrl?: string | null;
  packageServices?: { serviceId: string }[];
};

const eventTypeOptions = [
  { label: "Wedding", value: "WEDDING" },
  { label: "Birthday", value: "BIRTHDAY" },
  { label: "Corporate event", value: "CORPORATE" },
  { label: "Party", value: "PARTY" },
  { label: "Other", value: "OTHER" },
];

const initialState: ActionState = { success: null, error: null };

export function BookingForm({
  services,
  packages,
  catalogReady = true,
  taxRate = 0.18,
  initialPackageId = "",
  initialServiceId = "",
  capacity = {},
}: {
  services: CatalogService[];
  packages: CatalogPackage[];
  catalogReady?: boolean;
  taxRate?: number;
  initialPackageId?: string;
  /**
   * A service the customer asked for by name, from a service detail page. Seeding
   * a line is additive rather than a replacement, unlike the package: this state
   * is the customer's whole list of add-ons, not one choice.
   */
  initialServiceId?: string;
  capacity?: Record<string, CapacityView>;
}) {
  const [state, formAction, isSubmitting] = useActionState(createBookingAction, initialState);
  const [bookingKey] = useState(() => `booking_${crypto.randomUUID()}`);
  const [packageId, setPackageId] = useState(initialPackageId);
  const [guestCount, setGuestCount] = useState("100");
  /*
   * The event's dates.
   *
   * A range rather than a start date and a day count, because a customer who
   * typed "3" and a customer who picked three dates were describing the same
   * event — and the two answers could disagree, so the price and the stock
   * were computed from different lengths.
   */
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedServices, setSelectedServices] = useState<Record<string, number>>(() =>
    // Seeded through a function so the requested service is present in the very
    // first render: the server sends this markup, and a service line that only
    // appeared after hydration would flash the form as empty and then change the
    // total under the customer's eyes.
    initialServiceId ? { [initialServiceId]: 1 } : {},
  );

  useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state.success]);

  /**
   * Follow the requested package when it changes.
   *
   * `useState` reads its argument only on the first render, so this state is the
   * one place the URL could stop agreeing with the form. Navigating from
   * `/customer/bookings/new` to `/customer/bookings/new?package=…` is a
   * client-side transition between two URLs React considers the *same* page: the
   * server component re-renders with new search params, but the form is reused
   * rather than remounted, so the state keeps the old value and the chosen
   * package silently drops back to "Custom services". A hard load — or a refresh —
   * takes the initialiser path and works, which is exactly why the page looked
   * broken only when it was reached by clicking through.
   *
   * Keyed on the incoming value alone, so a customer who switches back to "Custom
   * services" keeps that choice: `initialPackageId` has not changed, the effect
   * does not run again, and nothing snaps the selection back. Guest count,
   * services and notes are left alone for the same reason — only the selection
   * follows the URL, the rest of the half-filled form survives the navigation.
   */
  useEffect(() => {
    setPackageId(initialPackageId);
  }, [initialPackageId]);

  /**
   * Same staleness problem as the package, but the fix cannot simply overwrite:
   * `selectedServices` is the running list of everything the customer has added,
   * so replacing it would throw away their own picks every time they followed a
   * link to another service. This only ever *adds*, and only when the URL names a
   * service that is not in the list yet.
   *
   * A quantity the customer already set is left alone, so going back and forth
   * between two service detail pages does not reset a line from 150 chairs back
   * to 1. Dropping the `service` parameter entirely changes nothing either: this
   * effect returns early and the customer's list survives.
   */
  useEffect(() => {
    if (!initialServiceId) return;
    setSelectedServices((current) => (current[initialServiceId] ? current : { ...current, [initialServiceId]: 1 }));
  }, [initialServiceId]);

  const guests = Math.max(10, Number(guestCount) || 10);
  /**
   * How long the event runs, taken from the range the customer picked.
   *
   * The same arithmetic the server does, so the estimate on screen is the
   * price that is charged. See `lib/event-dates.ts`.
   */
  const rangeDays = startDate && endDate ? eventDayCount(startDate, endDate) : null;
  const days = Math.min(MAX_EVENT_DAYS, rangeDays ?? 1);
  const maxEndDate = startDate
    ? new Date(Date.parse(`${startDate}T00:00:00.000Z`) + (MAX_EVENT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
    : undefined;
  const selectedPackage = packages.find((item) => item.id === packageId);
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const isPerGuest = useMemo(() => {
    const test = new Map<string, boolean>();
    for (const service of services) {
      test.set(service.id, service.pricingMode === "PER_GUEST" || (!service.pricingMode && ["chairs", "tables", "catering"].includes(service.slug)));
    }
    return test;
  }, [services]);
  const isPerDay = useMemo(() => new Map(services.map((service) => [service.id, service.pricingMode === "PER_DAY"])), [services]);

  /**
   * Only services priced per day read the day count, so the field is not shown to
   * somebody whose quote cannot change with it. A package counts too: its bundled
   * services are billed by their own pricing mode, which the customer never sees.
   */
  const usesPerDay = useMemo(() => {
    if (selectedPackage?.packageServices?.some((entry) => serviceMap.get(entry.serviceId)?.pricingMode === "PER_DAY")) return true;
    return Object.keys(selectedServices).some((serviceId) => isPerDay.get(serviceId));
  }, [isPerDay, selectedPackage, selectedServices, serviceMap]);

  /**
   * Units each selected line needs from its linked stock category. Per-person
   * services consume one unit per guest and per-day services draw their quantity
   * on each of those days, which is what makes a 400-guest request impossible on
   * a 200-chair inventory and a three-day function impossible on one night's
   * worth of crockery.
   */
  const unitsForLine = useCallback(
    (service: CatalogService, quantity: number) => {
      if (isPerGuest.get(service.id)) return guests;
      const base = Math.max(0, quantity);
      return isPerDay.get(service.id) ? base * days : base;
    },
    [days, guests, isPerDay, isPerGuest],
  );

  /**
   * Units of each stock category the selected lines draw on.
   *
   * A line that is linked to several categories draws one unit of **each** per
   * unit of itself — that is what a table-and-chair arrangement is — and lines
   * sharing a category add up, so two services compete for the same chairs.
   */
  const requiredByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const [serviceId, quantity] of Object.entries(selectedServices)) {
      const service = serviceMap.get(serviceId);
      if (!service?.inventoryCategories?.length) continue;
      const units = unitsForLine(service, quantity);
      if (units <= 0) continue;
      for (const category of service.inventoryCategories) {
        totals.set(category, (totals.get(category) ?? 0) + units);
      }
    }
    return totals;
  }, [selectedServices, serviceMap, unitsForLine]);

  const shortages = useMemo(
    () =>
      [...requiredByCategory]
        .map(([category, required]) => ({ category, required, available: capacity[category]?.available ?? 0 }))
        .filter((entry) => entry.required > entry.available),
    [requiredByCategory, capacity],
  );

  const hasStockShortage = shortages.length > 0;

  const packagePrice = selectedPackage ? Number(selectedPackage.price) : 0;
  const serviceTotal = Object.entries(selectedServices).reduce((sum, [serviceId, quantity]) => {
    const service = serviceMap.get(serviceId);
    if (!service) return sum;
    // The same multiplier the server prices the line with, so the estimate cannot
    // disagree with the quote that comes back.
    const multiplier = isPerGuest.get(serviceId) ? guests : isPerDay.get(serviceId) ? quantity * days : quantity;
    return sum + Number(service.basePrice) * multiplier;
  }, 0);
  const subtotal = packagePrice + serviceTotal;
  const total = subtotal * (1 + taxRate);
  /*
   * Today, in IST.
   *
   * `toISOString` gives the UTC date, which is five and a half hours behind
   * the business's own clock for most of the evening. Using it here meant the
   * booking form refused a date that was already today for the customer.
   */
  const today = istTodayKey();

  function toggleService(serviceId: string) {
    // While the request is in flight, the catalog controls are frozen so the
    // submitted quote cannot change under the customer's final click.
    if (isSubmitting) return;
    const service = serviceMap.get(serviceId);
    if (!service) return;
    // Refuse a line that cannot be given a single unit, rather than adding it at
    // quantity 1 and leaving the customer holding something only the stepper can
    // take back.
    if (!selectedServices[serviceId] && unitsLeftForNewLine(service) < 1) return;
    setSelectedServices((current) => {
      if (current[serviceId]) {
        const next = { ...current };
        delete next[serviceId];
        return next;
      }
      return { ...current, [serviceId]: 1 };
    });
  }

  /**
   * The stock categories this service is linked to. A service can name several,
   * and it draws one unit of **each** of them per unit of itself.
   */
  function categoriesOf(service: CatalogService) {
    return service.inventoryCategories ?? [];
  }

  /**
   * Units of one category left for a line that is not selected yet. A service
   * linked to several categories is bounded by its tightest one: a
   * table-and-chair arrangement cannot be added when there are no chairs left,
   * however many tables are spare.
   */
  function unitsLeftForNewLine(service: CatalogService) {
    const categories = categoriesOf(service);
    if (categories.length === 0) return Number.POSITIVE_INFINITY;
    // A per-day line spends at least one unit on each day, so stock one short of
    // a single day is still nothing to give it.
    const minimum = isPerDay.get(service.id) ? days : 1;
    let tightest = Number.POSITIVE_INFINITY;
    for (const category of categories) {
      const available = capacity[category]?.available ?? 0;
      const committed = requiredByCategory.get(category) ?? 0;
      tightest = Math.min(tightest, available - committed - (minimum - 1));
    }
    return tightest;
  }

  /** Units already claimed by the other selected lines in one category. */
  function committedElsewhere(service: CatalogService, selfId: string, category: string) {
    const total = requiredByCategory.get(category) ?? 0;
    return Math.max(0, total - unitsForLine(service, selectedServices[selfId] ?? 0));
  }

  /**
   * The largest quantity this line may still take without overbooking stock.
   *
   * Bounded by the tightest of its categories, so an arrangement linked to tables
   * and chairs stops at whichever runs out first.
   */
  function maxQuantityFor(service: CatalogService, selfId: string) {
    const categories = categoriesOf(service);
    if (categories.length === 0) return 100000;
    const perDay = isPerDay.get(service.id);
    let tightest = Number.POSITIVE_INFINITY;
    for (const category of categories) {
      const available = capacity[category]?.available ?? 0;
      const unitsLeft = Math.max(0, available - committedElsewhere(service, selfId, category));
      // A per-day line spends its whole quantity again on every day, so the
      // stepper counts how many it can afford *per day*.
      tightest = Math.min(tightest, perDay ? Math.floor(unitsLeft / days) : unitsLeft);
    }
    return tightest === Number.POSITIVE_INFINITY ? 100000 : tightest;
  }

  function changeQuantity(serviceId: string, delta: number) {
    if (isSubmitting) return;
    const service = serviceMap.get(serviceId);
    if (!service) return;
    const limit = maxQuantityFor(service, serviceId);
    // Stepping below one drops the line rather than pinning it at a quantity the
    // customer has no way to undo. A line another line has left with no units is
    // dropped here too.
    setSelectedServices((current) => applyQuantityStep(current, serviceId, delta, limit));
  }

  if (state.success) {
    return (
      <div className="rounded-[32px] border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm md:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="mt-6 text-3xl font-semibold text-emerald-950">Request received</h2>
        <p className="mx-auto mt-3 max-w-xl text-emerald-900/75">{state.success}</p>
        {state.bookingId ? (
          <p className="mt-4 text-sm font-medium text-emerald-900">
            Reference: {state.bookingId.slice(0, 8).toUpperCase()}
          </p>
        ) : null}
        {state.publicToken ? <Link href={`/customer/track?token=${encodeURIComponent(state.publicToken)}`} className="mt-3 inline-block text-sm font-semibold text-emerald-800 underline">View booking status</Link> : null}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button onClick={() => window.location.reload()}>Send another request</Button>
          <Link href="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <input type="hidden" name="idempotencyKey" value={bookingKey} suppressHydrationWarning />
      <div className="space-y-6">
        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-2xl font-semibold">Tell us about your event</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">We use these details to prepare an accurate proposal.</p>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              Your name <span className="text-red-600">*</span>
              <Input name="customerName" placeholder="Aarav Sharma" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Email address <span className="text-red-600">*</span>
              <Input name="customerEmail" type="email" placeholder="you@example.com" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Phone number <span className="text-red-600">*</span>
              <Input
                name="customerPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                minLength={10}
                maxLength={16}
                placeholder="+91 98765 43210"
                title="Enter a 10-digit mobile number, with +91 if you use a country code."
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-medium md:col-span-2">
              Address <span className="font-normal text-[var(--muted)]">(optional)</span>
              <Input name="customerAddress" autoComplete="street-address" maxLength={300} placeholder="House / street / area, city" />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Event type <span className="text-red-600">*</span>
              <Select name="eventType" options={eventTypeOptions} required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Event starts <span className="text-red-600">*</span>
              <Input
                name="eventDate"
                type="date"
                min={today}
                value={startDate}
                onChange={(event) => {
                  const next = event.target.value;
                  setStartDate(next);
                  // The end follows the start unless the customer has already
                  // chosen one, so moving the start does not leave a range that
                  // ends before it begins.
                  if (!endDate || eventDayCount(next, endDate) === null) setEndDate(next);
                }}
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Event ends <span className="text-red-600">*</span>
              <Input
                name="eventEndDate"
                type="date"
                min={startDate || today}
                max={maxEndDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
              {/*
                The day count is stated, not asked for. A customer who typed
                "3" and a customer who picked three dates were describing the
                same event, and the two answers could disagree. The range is
                what the calendar can be checked against, so the range decides
                the length and this line only reports it.
              */}
              <span className="text-xs font-normal text-[var(--muted)]">
                {!startDate || !endDate
                  ? "Pick the day your event starts and the day it ends."
                  : rangeDays === null
                    ? "The end date must be on or after the start date."
                    : `Your event runs for ${rangeDays} day${rangeDays === 1 ? "" : "s"}.`}
              </span>
            </label>
            {/*
              The day count is derived from the range above and sent as a
              hidden field, so the request carries the length the server
              should bill and reserve. The server re-derives it from the range
              and refuses a request whose two answers disagree, so this value
              is a convenience rather than the authority.
            */}
            <input type="hidden" name="durationDays" value={days} />
            <label className="grid gap-2 text-sm font-medium">
              Guest count <span className="text-red-600">*</span>
              <Input
                name="guestCount"
                type="number"
                min="10"
                max="100000"
                value={guestCount}
                onChange={(event) => setGuestCount(event.target.value)}
                required
              />
            </label>
            {usesPerDay ? (
              <p className="rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)] md:col-span-2">
                Services priced per day are charged, and reserved, for each of the {days} day{days === 1 ? "" : "s"} in your date range.
              </p>
            ) : null}
            <label className="grid gap-2 text-sm font-medium md:col-span-2">
              Event location <span className="text-red-600">*</span>
              <SuggestedInput list="event-location-suggestions" suggestions={EVENT_LOCATION_SUGGESTIONS} name="location" placeholder="Start typing a venue, area, or city" required />
            </label>
            <label className="grid gap-2 text-sm font-medium md:col-span-2">
              Anything we should know? <span className="text-sm font-normal text-[var(--muted)]">(optional)</span>
              <Textarea name="notes" placeholder="Theme preferences, access constraints, special requirements…" />
            </label>
          </div>
        </section>

        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm md:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Choose a package</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Start with a curated setup, then add any services you need.</p>
          </div>
          <fieldset disabled={isSubmitting} className="m-0 grid min-w-0 gap-3 border-0 p-0">
            <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${!packageId ? "border-amber-400 bg-amber-50" : "border-stone-200 hover:border-amber-300"}`}>
              <input className="mt-1 accent-amber-600" type="radio" name="packageId" value="" checked={!packageId} onChange={() => setPackageId("")} />
              <span>
                <span className="block font-semibold text-[var(--foreground)]">Custom services</span>
                <span className="mt-1 block text-sm text-[var(--muted)]">Build a quote from the services you choose below.</span>
              </span>
            </label>
            {packages.map((item) => (
              <label key={item.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${packageId === item.id ? "border-amber-400 bg-amber-50" : "border-stone-200 hover:border-amber-300"}`}>
                <input className="mt-1 accent-amber-600" type="radio" name="packageId" value={item.id} checked={packageId === item.id} onChange={() => setPackageId(item.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--foreground)]">{item.name}</span>
                    <span className="font-semibold text-amber-800">{formatCurrency(item.price)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">{item.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Add services</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Per-person services use your guest count automatically.</p>
            </div>
            <CircleHelp className="h-5 w-5 shrink-0 text-[var(--muted)]" />
          </div>
          <fieldset disabled={isSubmitting} className="m-0 grid min-w-0 gap-3 border-0 p-0">
            {services.map((service) => {
              const perGuest = isPerGuest.get(service.id) ?? false;
              const perDay = isPerDay.get(service.id) ?? false;
              const selected = Boolean(selectedServices[service.id]);
              const categories = service.inventoryCategories ?? [];
              const units = unitsForLine(service, selectedServices[service.id] ?? 1);
              // A service can draw on several categories, one unit of each per
              // unit of itself. It cannot be offered at all when *any* of them is
              // exhausted or unconfigured — an arrangement with no chairs left is
              // not bookable however many tables are spare — and it is capped by
              // the tightest of the rest.
              const views = categories.map((category) => ({ category, view: capacity[category] }));
              const unconfigured = views.filter((entry) => !entry.view);
              const exhaustedCategories = views.filter((entry) => entry.view && entry.view.available <= 0);
              const limiting = views
                .filter((entry) => entry.view)
                .reduce<{ category: string; available: number } | null>((tightest, entry) => {
                  const available = entry.view?.available ?? 0;
                  return tightest === null || available < tightest.available ? { category: entry.category, available } : tightest;
                }, null);
              const unavailable = categories.length > 0 && (unconfigured.length > 0 || exhaustedCategories.length > 0);
              const available = limiting?.available ?? null;
              const overLimit = limiting !== null && units > limiting.available;
              const atLimit = limiting !== null && units >= limiting.available && !unavailable;
              const limit = maxQuantityFor(service, service.id);
              const stockLine = views
                .map((entry) => {
                  const label = formatInventoryCategory(entry.category).toLowerCase();
                  return entry.view ? `${entry.view.available} ${label}` : `no ${label} stock`;
                })
                .join(" · ");

              return (
                <div key={service.id} className={`rounded-2xl border p-4 transition ${unavailable && !selected ? "border-[var(--danger-text)]/30 bg-[var(--danger-soft)]" : selected ? "border-amber-300 bg-amber-50/60" : "border-stone-200"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className={`flex items-start gap-3 ${unavailable && !selected ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                      <input
                        className="mt-1 accent-amber-600"
                        type="checkbox"
                        checked={selected}
                        // Only a *new* line can be refused. Disabling the checkbox
                        // for a line that is already selected locks the customer
                        // into it: the category it draws on can read as exhausted
                        // while the line is selected, and then there is no way at
                        // all to take the line back out.
                        disabled={unavailable && !selected}
                        onChange={() => toggleService(service.id)}
                      />
                      <span>
                        <span className="block font-medium text-[var(--foreground)]">{service.name}</span>
                        <span className="mt-1 block text-sm text-[var(--muted)]">
                          {formatCurrency(service.basePrice)} {perGuest ? "per guest" : perDay ? "per day" : `per ${service.unitLabel}`}
                        </span>
                        {categories.length > 0 ? (
                          <span className="mt-1 block text-xs text-[var(--muted)]">
                            {stockLine}
                            {perGuest ? ` · ${units} of each needed for ${guests} guests` : ""}
                            {perDay && days > 1 ? ` · ${units} of each needed for ${days} days` : ""}
                          </span>
                        ) : null}
                      </span>
                    </label>
                    {selected && !perGuest ? (
                      <div className="flex items-center gap-2 pl-7 sm:pl-0">
                        {/*
                          The stepper is never disabled: at a quantity of one the
                          button removes the line instead of doing nothing, so a
                          line added by mistake can be taken back without having
                          to find the checkbox.
                        */}
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => changeQuantity(service.id, -1)}
                          aria-label={selectedServices[service.id] <= 1 ? `Remove ${service.name}` : `Decrease ${service.name} quantity`}
                          title={selectedServices[service.id] <= 1 ? `Remove ${service.name}` : undefined}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center text-sm font-semibold">{selectedServices[service.id]}</span>
                        <Button type="button" variant="outline" size="icon" disabled={atLimit} onClick={() => changeQuantity(service.id, 1)} aria-label={`Increase ${service.name} quantity`}><Plus className="h-4 w-4" /></Button>
                        {available !== null ? <span className="text-xs text-[var(--muted)]">max {Math.max(0, limit)}</span> : null}
                      </div>
                    ) : null}

                  </div>
                  {unavailable ? (
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--danger-text)]">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {unconfigured.length > 0
                          ? `No active ${unconfigured.map((entry) => formatInventoryCategory(entry.category).toLowerCase()).join(" or ")} stock is configured, so this service cannot be booked yet.`
                          : `Fully booked right now${exhaustedCategories.length > 1 ? " in every category it needs" : ""}. Please pick another service or contact us for a custom plan.`}
                      </span>
                    </p>
                  ) : overLimit && limiting ? (
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--warning-text)]">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        This line needs {units} {formatInventoryCategory(limiting.category).toLowerCase()} but only {limiting.available}{" "}
                        {limiting.available === 1 ? "is" : "are"} left
                        {perGuest
                          ? ". Reduce your guest count to continue."
                          : limit < 1
                            ? ". Another service in this request is using the last of them."
                            : perDay
                              ? `. Reduce the quantity to ${limit} per day, or shorten the event.`
                              : `. Reduce the quantity to ${limit} or fewer.`}
                      </span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          <input type="hidden" name="services" value={JSON.stringify(Object.entries(selectedServices).map(([serviceId, quantity]) => ({ serviceId, quantity })))} />
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-4 rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Your estimate</h2>
          <div className="space-y-3 border-b border-stone-100 pb-5 text-sm">
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Package</span><span className="font-medium">{packagePrice ? formatCurrency(packagePrice) : "Custom"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Guests</span><span className="font-medium">{guests}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Add-ons</span><span className="font-medium">{formatCurrency(serviceTotal)}</span></div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[var(--muted)]">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Tax ({Math.round(taxRate * 100)}%)</span><span>{formatCurrency(total - subtotal)}</span></div>
            <div className="flex justify-between border-t border-stone-100 pt-3 text-lg font-semibold"><span>Estimated total</span><span className="text-amber-800">{formatCurrency(total)}</span></div>
          </div>
          <p className="text-xs leading-5 text-[var(--muted)]">This is an estimate. Our team will confirm availability, quantities, and the final quote before any payment is due.</p>
          {hasStockShortage ? (
            <p role="alert" className="rounded-2xl border border-[var(--danger-text)]/30 bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger-text)]">
              <span className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4" />
                Not enough stock for this request
              </span>
              <span className="mt-1 block">
                {shortages
                  .map((entry) => `${formatInventoryCategory(entry.category).toLowerCase()}: ${entry.required} needed, ${entry.available} available`)
                  .join(". ")}
                . Adjust the quantities or contact us and we will plan an alternative.
              </span>
            </p>
          ) : null}
          {!catalogReady ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">Booking requests are temporarily unavailable while the catalog is being prepared. Please contact us directly and we will help plan your event.</p> : null}
          <ActionFeedback state={state} />
          {/*
            Sending the request is the part that needs an account; browsing the
            catalog above does not. Both ways forward are offered because the
            visitor cannot be told which one applies — asking them would answer
            "do you already have an account with this address?", which is the same
            question the form must not answer.
          */}
          {state.code === "ACCOUNT_REQUIRED" ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">
              <span className="block">Sending this request needs a customer account, so the booking is kept against one.</span>
              <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link href="/customer/auth/sign-in" className="font-semibold underline underline-offset-2">
                  Sign in
                </Link>
                <Link href="/customer/auth/sign-up" className="font-semibold underline underline-offset-2">
                  Create an account
                </Link>
              </span>
            </p>
          ) : null}
          <SubmitButton className="w-full" disabled={!catalogReady || hasStockShortage}>Send booking request</SubmitButton>
          <p className="text-center text-xs text-[var(--muted)]">Browsing is open to everyone. Sending a request needs a customer account, so the booking is kept against one.</p>
        </div>
      </aside>
    </form>
  );
}
