import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteHeader } from "@/components/layout/site-header";

export const revalidate = 60;
export async function generateMetadata(): Promise<Metadata> {
  const settings = await prisma.businessSetting.findUnique({ where: { id: "default" }, select: { businessName: true } }).catch(() => null);
  const businessName = settings?.businessName || "Event Management";
  return { title: `Contact ${businessName}`, description: `Contact ${businessName} to discuss your date, venue, guest count, and services.`, alternates: { canonical: absoluteUrl("/contact") }, openGraph: { title: `Contact ${businessName}`, description: "Discuss your event details with our team.", url: absoluteUrl("/contact") } };
}

export default async function ContactPage() {
  const settings = await prisma.businessSetting.findUnique({ where: { id: "default" }, select: { businessName: true, email: true, phone: true, address: true, city: true } }).catch(() => null);
  const name = settings?.businessName || "Event Management";
  return <><SiteHeader businessName={name} /><main className="container-shell space-y-8 py-12"><Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to home</Link><div className="max-w-3xl space-y-5"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Contact</p><h1 className="text-4xl font-semibold sm:text-6xl">Let’s talk about your event.</h1><p className="text-lg leading-8 text-[var(--muted)]">Share the essentials and our team will help you understand availability, services, and the next steps.</p><Link href="/customer/bookings/new"><Button size="lg">Request an event quote</Button></Link></div><Card className="max-w-2xl"><CardHeader><CardTitle>{name}</CardTitle></CardHeader><CardContent className="grid gap-4 text-[var(--muted)]">{settings?.email ? <a className="flex items-center gap-3 hover:text-[var(--foreground)]" href={`mailto:${settings.email}`}><Mail className="h-5 w-5 text-amber-700" />{settings.email}</a> : null}{settings?.phone ? <a className="flex items-center gap-3 hover:text-[var(--foreground)]" href={`tel:${settings.phone}`}><Phone className="h-5 w-5 text-amber-700" />{settings.phone}</a> : null}{settings?.address || settings?.city ? <p className="flex items-center gap-3"><MapPin className="h-5 w-5 text-amber-700" />{[settings.address, settings.city].filter(Boolean).join(", ")}</p> : null}{!settings?.email && !settings?.phone && !settings?.address && !settings?.city ? <p>Business contact details will appear here once they are published.</p> : null}</CardContent></Card></main></>;
}
