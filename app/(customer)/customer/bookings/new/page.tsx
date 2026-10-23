import type { Metadata } from "next";
import { ArrowLeft, CalendarDays, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getBookingFormData } from "@/lib/bookings";
import { prisma } from "@/lib/prisma";
import { BookingForm } from "@/components/booking/booking-form";
import { Badge } from "@/components/ui/badge";
import { JsonLd } from "@/components/seo/json-ld";
import { absoluteUrl } from "@/lib/site";
import type { CapacityView } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const settings = await prisma.businessSetting.findUnique({ where: { id: "default" }, select: { businessName: true } }).catch(() => null);
  const businessName = settings?.businessName || "Event Management";
  return {
    title: `Request a quote from ${businessName}`,
    description: `Tell ${businessName} about your date, venue, guests, and services. Receive a clear quote and keep your booking details in one place.`,
    alternates: { canonical: absoluteUrl("/customer/bookings/new") },
    openGraph: { title: `Request a quote from ${businessName}`, description: "Share your event details and receive a tailored proposal.", url: absoluteUrl("/customer/bookings/new") },
    twitter: { card: "summary", title: `Request a quote from ${businessName}`, description: "Share your event details and receive a tailored proposal." },
  };
}

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ package?: string; service?: string }> }) {
  const query = await searchParams;
  // Both ids come from the URL, so both are bounded and both are checked against
  // the catalog fetched below before they are allowed to preselect anything: an id
  // that names a deleted, deactivated or never-existed row falls back to an empty
  // form rather than a line the server would then price but cannot fulfil.
  const requestedPackageId = typeof query.package === "string" && query.package.length <= 100 ? query.package : "";
  const requestedServiceId = typeof query.service === "string" && query.service.length <= 100 ? query.service : "";
  let services: Array<{ id: string; name: string; slug: string; basePrice: number; unitLabel: string; pricingMode: "FIXED" | "PER_GUEST" | "PER_DAY"; inventoryCategories: string[] }> = [];
  let packages: Array<{ id: string; name: string; description: string; price: number; imageUrl: string | null; packageServices: { serviceId: string }[] }> = [];
  let taxRate = 0.18;
  let capacity: Record<string, CapacityView> = {};

  try {
    const [data, settings] = await Promise.all([
      getBookingFormData(),
      prisma.businessSetting.findUnique({ where: { id: "default" }, select: { taxRate: true } }),
    ]);
    const configuredTaxRate = settings ? Number(settings.taxRate) : taxRate;
    taxRate = Number.isFinite(configuredTaxRate) ? Math.min(1, Math.max(0, configuredTaxRate)) : taxRate;
    capacity = data.capacity;
    services = data.services.map((service) => ({
      id: service.id,
      name: service.name,
      slug: service.slug,
      basePrice: Number(service.basePrice),
      unitLabel: service.unitLabel,
      pricingMode: service.pricingMode,
      inventoryCategories: service.inventoryCategories,
    }));
    packages = data.packages.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      imageUrl: item.imageUrl,
      packageServices: item.packageServices.map((service) => ({ serviceId: service.serviceId })),
    }));
  } catch {
    // An empty catalog is safer than showing fake services that cannot be booked.
  }

  const catalogReady = services.length > 0 || packages.length > 0;

  return (
    <div className="space-y-8">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") }, { "@type": "ListItem", position: 2, name: "Request a quote", item: absoluteUrl("/customer/bookings/new") }] }} />
      <div className="flex flex-col gap-5">
        <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to home</Link>
        <div className="max-w-3xl space-y-4"><Badge className="w-fit bg-amber-100 text-amber-900">Event planning request</Badge><h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl md:text-6xl">Let&apos;s plan something memorable.</h1><p className="text-base leading-8 text-[var(--muted)] sm:text-lg">Share a few details and our team will turn them into a clear, tailored proposal. Sending the request needs a customer account.</p></div>
        <div className="grid gap-3 sm:grid-cols-3">{[{ icon: CalendarDays, title: "Choose your date", detail: "Tell us when your event is happening." }, { icon: CheckCircle2, title: "Get a clear quote", detail: "We confirm packages, stock, and timing." }, { icon: ShieldCheck, title: "Book with confidence", detail: "No payment is due with your request." }].map(({ icon: Icon, title, detail }) => <div key={title} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"><Icon className="h-5 w-5 text-amber-700" /><p className="mt-3 font-semibold">{title}</p><p className="mt-1 text-sm text-[var(--muted)]">{detail}</p></div>)}</div>
      </div>
      <BookingForm services={services} packages={packages} catalogReady={catalogReady} taxRate={taxRate} capacity={capacity} initialPackageId={packages.some((item) => item.id === requestedPackageId) ? requestedPackageId : ""} initialServiceId={services.some((item) => item.id === requestedServiceId) ? requestedServiceId : ""} />
    </div>
  );
}
