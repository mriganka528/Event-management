import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { absoluteUrl } from "@/lib/site";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { SiteHeader } from "@/components/layout/site-header";

export const revalidate = 60;
export const metadata: Metadata = { title: "Event packages", description: "Browse event packages and request a tailored quote for your celebration.", alternates: { canonical: absoluteUrl("/packages") } };

export default async function PackagesPage() {
  const [packages, settings] = await Promise.all([
    prisma.package.findMany({ where: { isActive: true, packageServices: { some: { service: { isActive: true } } } }, include: { packageServices: { where: { service: { isActive: true } }, include: { service: true } } }, orderBy: { price: "asc" } }),
    prisma.businessSetting.findUnique({ where: { id: "default" }, select: { currency: true, businessName: true, logoUrl: true } }),
  ]);
  const currency = /^[A-Za-z]{3}$/.test(settings?.currency ?? "") ? settings!.currency.toUpperCase() : "INR";
  return <><SiteHeader businessName={settings?.businessName || "Event Management"} logoUrl={settings?.logoUrl ?? null} /><main className="container-shell space-y-10 py-12"><div className="max-w-3xl space-y-4"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Packages</p><h1 className="text-4xl font-semibold sm:text-6xl">Choose a starting point for your event.</h1><p className="text-lg text-[var(--muted)]">Every package is assembled from the services your team currently offers. Request a quote and we will confirm availability for your date.</p></div>{packages.length === 0 ? <EmptyState title="Packages are being prepared" description="Our team is preparing the current package catalog. You can still request a custom quote." action={<Link href="/customer/bookings/new"><Button>Request a custom quote</Button></Link>} /> : <div className="grid gap-6 md:grid-cols-2">{packages.map((item) => <Card key={item.id} className="overflow-hidden"><div className="relative aspect-[16/8] bg-[var(--surface)]">{item.imageUrl ? <Image src={item.imageUrl} alt={`${item.name} event package`} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted)]"><ShoppingBag className="h-10 w-10" /></div>}</div><CardContent className="space-y-4 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><Badge className="bg-amber-100 text-amber-900">{item.packageServices.length} services</Badge><p className="text-xl font-semibold">{formatCurrency(item.price, currency)}</p></div><h2 className="text-2xl font-semibold"><Link href={`/packages/${item.slug}`} className="hover:text-amber-800">{item.name}</Link></h2><p className="text-[var(--muted)]">{item.description}</p><Link href={`/packages/${item.slug}`} className="inline-flex items-center gap-2 text-sm font-semibold text-amber-800 hover:underline">View package details <ArrowRight className="h-4 w-4" /></Link></CardContent></Card>)}</div>}</main></>;
}
