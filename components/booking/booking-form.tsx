"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { toast } from "react-hot-toast";
import { Check, CircleHelp, Minus, Plus, Sparkles } from "lucide-react";
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

type CatalogService = {
  id: string;
  name: string;
  slug: string;
  basePrice: number | string;
  unitLabel: string;
  pricingMode?: "FIXED" | "PER_GUEST";
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
}: {
  services: CatalogService[];
  packages: CatalogPackage[];
  catalogReady?: boolean;
  taxRate?: number;
  initialPackageId?: string;
}) {
  const [state, formAction] = useActionState(createBookingAction, initialState);
  const [bookingKey] = useState(() => `booking_${crypto.randomUUID()}`);
  const [packageId, setPackageId] = useState(initialPackageId);
  const [guestCount, setGuestCount] = useState("100");
  const [selectedServices, setSelectedServices] = useState<Record<string, number>>({});

  useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state.success]);

  const guests = Math.max(10, Number(guestCount) || 10);
  const selectedPackage = packages.find((item) => item.id === packageId);
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const packagePrice = selectedPackage ? Number(selectedPackage.price) : 0;
  const serviceTotal = Object.entries(selectedServices).reduce((sum, [serviceId, quantity]) => {
    const service = serviceMap.get(serviceId);
    if (!service) return sum;
    const multiplier = service.pricingMode === "PER_GUEST" || (!service.pricingMode && ["chairs", "tables", "catering"].includes(service.slug)) ? guests : quantity;
    return sum + Number(service.basePrice) * multiplier;
  }, 0);
  const subtotal = packagePrice + serviceTotal;
  const total = subtotal * (1 + taxRate);
  const today = new Date().toISOString().slice(0, 10);

  function toggleService(serviceId: string) {
    setSelectedServices((current) => {
      if (current[serviceId]) {
        const next = { ...current };
        delete next[serviceId];
        return next;
      }
      return { ...current, [serviceId]: 1 };
    });
  }

  function changeQuantity(serviceId: string, delta: number) {
    setSelectedServices((current) => ({
      ...current,
      [serviceId]: Math.max(1, (current[serviceId] ?? 1) + delta),
    }));
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
              <Input name="customerPhone" type="tel" placeholder="+91 98765 43210" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Event type <span className="text-red-600">*</span>
              <Select name="eventType" options={eventTypeOptions} required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Event date <span className="text-red-600">*</span>
              <Input name="eventDate" type="date" min={today} required />
            </label>
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
          <div className="grid gap-3">
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
          </div>
        </section>

        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Add services</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Per-person services use your guest count automatically.</p>
            </div>
            <CircleHelp className="h-5 w-5 shrink-0 text-[var(--muted)]" />
          </div>
          <div className="grid gap-3">
            {services.map((service) => {
              const selected = Boolean(selectedServices[service.id]);
              const isPerGuest = service.pricingMode === "PER_GUEST" || (!service.pricingMode && ["chairs", "tables", "catering"].includes(service.slug));
              return (
                <div key={service.id} className={`rounded-2xl border p-4 transition ${selected ? "border-amber-300 bg-amber-50/60" : "border-stone-200"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input className="mt-1 accent-amber-600" type="checkbox" checked={selected} onChange={() => toggleService(service.id)} />
                      <span>
                        <span className="block font-medium text-[var(--foreground)]">{service.name}</span>
                        <span className="mt-1 block text-sm text-[var(--muted)]">
                          {formatCurrency(service.basePrice)} {isPerGuest ? "per guest" : `per ${service.unitLabel}`}
                        </span>
                      </span>
                    </label>
                    {selected && !isPerGuest ? (
                      <div className="flex items-center gap-2 pl-7 sm:pl-0">
                        <Button type="button" variant="outline" size="icon" onClick={() => changeQuantity(service.id, -1)} aria-label={`Decrease ${service.name} quantity`}><Minus className="h-4 w-4" /></Button>
                        <span className="w-8 text-center text-sm font-semibold">{selectedServices[service.id]}</span>
                        <Button type="button" variant="outline" size="icon" onClick={() => changeQuantity(service.id, 1)} aria-label={`Increase ${service.name} quantity`}><Plus className="h-4 w-4" /></Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
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
          {!catalogReady ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">Booking requests are temporarily unavailable while the catalog is being prepared. Please contact us directly and we will help plan your event.</p> : null}
          <ActionFeedback state={state} />
          <SubmitButton className="w-full" disabled={!catalogReady}>Send booking request</SubmitButton>
          <p className="text-center text-xs text-[var(--muted)]">No account is required to send a new booking request.</p>
        </div>
      </aside>
    </form>
  );
}
