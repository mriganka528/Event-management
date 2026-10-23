import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { absoluteUrl } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { SiteHeader } from "@/components/layout/site-header";

export const revalidate = 60;
export const metadata: Metadata = { title: "Event services", description: "Explore event services available for weddings, birthdays, corporate events, and celebrations.", alternates: { canonical: absoluteUrl("/services") } };

export default async function ServicesPage() {
  const [services, settings] = await Promise.all([
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.businessSetting.findUnique({ where: { id: "default" }, select: { currency: true, businessName: true, logoUrl: true } }),
  ]);
  const currency = /^[A-Za-z]{3}$/.test(settings?.currency ?? "") ? settings!.currency.toUpperCase() : "INR";
  return <><SiteHeader businessName={settings?.businessName || "Event Management"} logoUrl={settings?.logoUrl ?? null} /><main className="container-shell space-y-10 py-12"><div className="max-w-3xl space-y-4"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Services</p><h1 className="text-4xl font-semibold sm:text-6xl">Build an event around what you need.</h1><p className="text-lg text-[var(--muted)]">Browse the current service catalog, then request a tailored quote with your date, venue, and guest count.</p></div>{services.length === 0 ? <EmptyState title="Services are being prepared" description="Our team is preparing the service catalog. Send a request and we will help shape the right plan." action={<Link href="/customer/bookings/new"><Button>Request a custom quote</Button></Link>} /> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <Card key={service.id} className="h-full"><CardContent className="flex h-full flex-col gap-4 p-6"><div className="flex items-start justify-between gap-3"><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><Wrench className="h-5 w-5" /></span><p className="text-xl font-semibold">{formatCurrency(service.basePrice, currency)}</p></div><h2 className="text-2xl font-semibold"><Link href={`/services/${service.slug}`} className="hover:text-amber-800">{service.name}</Link></h2><p className="flex-1 text-sm leading-6 text-[var(--muted)]">{service.description || "A flexible event service configured by our team."}</p><p className="text-xs uppercase tracking-wider text-[var(--muted)]">Per {service.unitLabel}</p><Link href={`/services/${service.slug}`} className="inline-flex items-center gap-2 text-sm font-semibold text-amber-800 hover:underline">View service <ArrowRight className="h-4 w-4" /></Link></CardContent></Card>)}</div>}</main></>;
}
