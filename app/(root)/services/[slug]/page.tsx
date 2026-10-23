import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { absoluteUrl } from "@/lib/site";
import { JsonLd } from "@/components/seo/json-ld";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteHeader } from "@/components/layout/site-header";

export const revalidate = 60;
type PageProps = { params: Promise<{ slug: string }> };

const getService = cache((slug: string) =>
  prisma.service.findFirst({ where: { slug, isActive: true } }),
);

export async function generateStaticParams() {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    select: { slug: true },
  });
  return services.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const service = await getService(slug);
  if (!service) return { title: "Service not found", robots: { index: false, follow: false } };
  return { title: `${service.name} event service`, description: service.description || `${service.name} for your event.`, alternates: { canonical: absoluteUrl(`/services/${service.slug}`) }, openGraph: { title: service.name, description: service.description || `${service.name} event service`, url: absoluteUrl(`/services/${service.slug}`) }, twitter: { card: "summary", title: service.name, description: service.description || `${service.name} event service` } };
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [service, settings] = await Promise.all([getService(slug), prisma.businessSetting.findUnique({ where: { id: "default" }, select: { currency: true, businessName: true, logoUrl: true } })]);
  if (!service) notFound();
  const currency = /^[A-Za-z]{3}$/.test(settings?.currency ?? "") ? settings!.currency.toUpperCase() : "INR";
  return <><SiteHeader businessName={settings?.businessName || "Event Management"} logoUrl={settings?.logoUrl ?? null} /><main className="container-shell space-y-8 py-12"><Link href="/services" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to services</Link><div className="max-w-3xl space-y-5"><Badge className="w-fit bg-amber-100 text-amber-900">Event service</Badge><h1 className="text-4xl font-semibold sm:text-6xl">{service.name}</h1><p className="text-lg leading-8 text-[var(--muted)]">{service.description || "A flexible service configured by our event team."}</p><p className="text-3xl font-semibold">{formatCurrency(service.basePrice, currency)} <span className="text-base font-normal text-[var(--muted)]">per {service.unitLabel}</span></p><Link href={`/customer/bookings/new?service=${service.id}`}><Button size="lg">Request this service <ArrowRight className="ml-2 h-4 w-4" /></Button></Link></div><Card><CardHeader><CardTitle>What happens next</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">{["Share your event details", "Receive a tailored quote", "Confirm your booking"].map((step, index) => <div key={step} className="rounded-2xl bg-[var(--surface-muted)] p-5"><p className="text-sm font-semibold text-amber-800">Step {index + 1}</p><p className="mt-2 font-semibold">{step}</p></div>)}</CardContent></Card><JsonLd data={{ "@context": "https://schema.org", "@type": "Service", name: service.name, description: service.description || undefined, provider: { "@type": "Organization", name: "Event Management" }, offers: { "@type": "Offer", price: Number(service.basePrice), priceCurrency: currency, url: absoluteUrl(`/services/${service.slug}`) } }} /></main></>;
}
