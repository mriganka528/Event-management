import type { Metadata } from "next";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ShoppingBag } from "lucide-react";
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

const getPackage = cache((slug: string) =>
  prisma.package.findFirst({ where: { slug, isActive: true, packageServices: { some: { service: { isActive: true } } } }, include: { packageServices: { where: { service: { isActive: true } }, include: { service: true } } } }),
);

export async function generateStaticParams() {
  const packages = await prisma.package.findMany({
    where: { isActive: true, packageServices: { some: { service: { isActive: true } } } },
    select: { slug: true },
  });
  return packages.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const item = await getPackage(slug);
  if (!item) return { title: "Package not found", robots: { index: false, follow: false } };
  return { title: `${item.name} event package`, description: item.description, alternates: { canonical: absoluteUrl(`/packages/${item.slug}`) }, openGraph: { title: item.name, description: item.description, url: absoluteUrl(`/packages/${item.slug}`), ...(item.imageUrl ? { images: [{ url: item.imageUrl, alt: `${item.name} event package` }] } : {}) }, twitter: { card: "summary_large_image", title: item.name, description: item.description, ...(item.imageUrl ? { images: [item.imageUrl] } : {}) } };
}

export default async function PackageDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [item, settings] = await Promise.all([getPackage(slug), prisma.businessSetting.findUnique({ where: { id: "default" }, select: { currency: true, businessName: true } })]);
  if (!item) notFound();
  const currency = /^[A-Za-z]{3}$/.test(settings?.currency ?? "") ? settings!.currency.toUpperCase() : "INR";
  return <><SiteHeader businessName={settings?.businessName || "Event Management"} /><main className="container-shell space-y-8 py-12"><Link href="/packages" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to packages</Link><div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center"><div className="relative aspect-[4/3] overflow-hidden rounded-[32px] bg-[var(--surface)] shadow-sm">{item.imageUrl ? <Image src={item.imageUrl} alt={`${item.name} event package`} fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted)]"><ShoppingBag className="h-12 w-12" /></div>}</div><div className="space-y-6"><Badge className="w-fit bg-amber-100 text-amber-900">Event package</Badge><h1 className="text-4xl font-semibold sm:text-6xl">{item.name}</h1><p className="text-lg leading-8 text-[var(--muted)]">{item.description}</p><p className="text-3xl font-semibold">{formatCurrency(item.price, currency)}</p><Link href={`/customer/bookings/new?package=${item.id}`}><Button size="lg">Request this package</Button></Link></div></div><Card><CardHeader><CardTitle>What is included</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{item.packageServices.map((entry) => <div key={entry.serviceId} className="flex items-start gap-3 rounded-2xl bg-[var(--surface-muted)] p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="font-semibold">{entry.service.name}</p><p className="text-sm text-[var(--muted)]">{entry.service.description || "Included event service"}</p></div></div>)}</CardContent></Card><JsonLd data={{ "@context": "https://schema.org", "@type": "Product", name: item.name, description: item.description, image: item.imageUrl ?? undefined, offers: { "@type": "Offer", price: Number(item.price), priceCurrency: currency, availability: "https://schema.org/InStock", url: absoluteUrl(`/packages/${item.slug}`) } }} /></main></>;
}
