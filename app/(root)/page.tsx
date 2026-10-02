import type { Metadata } from "next";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, CheckCircle2, Headphones, MapPin, Sparkles } from "lucide-react";
import { getBookingFormData } from "@/lib/bookings";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Carousel } from "@/components/marketing/carousel";
import { formatCurrency } from "@/lib/utils";
import { absoluteUrl } from "@/lib/site";
import { JsonLd } from "@/components/seo/json-ld";

export const revalidate = 60;

const getPublicHomeData = cache(async () => {
  const [catalog, settings] = await Promise.all([
    getBookingFormData(),
    prisma.businessSetting.findUnique({ where: { id: "default" } }),
  ]);
  return { catalog, settings };
});

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { settings, catalog } = await getPublicHomeData();
    const businessName = settings?.businessName || "Event Management";
    const city = settings?.city ? ` in ${settings.city}` : "";
    const heroImage = catalog.packages.find((item) => item.imageUrl)?.imageUrl;
    return {
      title: `${businessName} | Event planning${city}`,
      description: `Plan weddings, birthdays, corporate events, and celebrations with ${businessName}. Request a clear quote and manage your event with confidence.`,
      alternates: { canonical: absoluteUrl("/") },
      openGraph: { title: `${businessName} | Event planning${city}`, description: "Plan, manage, and deliver memorable events.", url: absoluteUrl("/"), images: heroImage ? [{ url: heroImage, alt: `${businessName} event setup` }] : undefined },
      twitter: { card: "summary_large_image", title: businessName, description: "Plan, manage, and deliver memorable events." },
    };
  } catch {
    return { title: "Event Management | Event planning", description: "Plan, manage, and deliver memorable events.", alternates: { canonical: absoluteUrl("/") } };
  }
}

const categories = [
  { name: "Wedding", icon: Sparkles, description: "Thoughtful setup, decor, and guest experience for the day you have been planning." },
  { name: "Birthday", icon: CalendarDays, description: "A memorable atmosphere with room for food, music, photos, and celebration." },
  { name: "Corporate", icon: Headphones, description: "Reliable production and professional coordination for launches and company events." },
  { name: "Party", icon: MapPin, description: "Flexible event layouts designed around your venue, guest count, and style." },
];

export default async function Home() {
  let packages: Array<{ id: string; name: string; price: number; description: string; image: string | null }> = [];
  let serviceCount = 0;
  let settings: { businessName: string; email: string; phone: string; address: string; city: string; currency: string } = { businessName: "Event Management", email: "", phone: "", address: "", city: "", currency: "INR" };

  try {
    const { catalog, settings: savedSettings } = await getPublicHomeData();
    serviceCount = catalog.services.length;
    packages = catalog.packages.map((item) => ({ id: item.id, name: item.name, price: Number(item.price), description: item.description, image: item.imageUrl }));
    if (savedSettings) settings = { businessName: savedSettings.businessName || "Event Management", email: savedSettings.email, phone: savedSettings.phone, address: savedSettings.address, city: savedSettings.city, currency: savedSettings.currency || "INR" };
  } catch {
    // The public page remains readable while the database is being initialized.
  }

  const heroImage = packages.find((item) => item.image)?.image ?? null;
  const galleryImages = packages.flatMap((item) => item.image ? [{ id: item.id, src: item.image, name: item.name }] : []);
  const hasContact = Boolean(settings.email || settings.phone || settings.address || settings.city);
  const currency = /^[A-Za-z]{3}$/.test(settings.currency) ? settings.currency.toUpperCase() : "INR";
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${absoluteUrl("/")}#organization`, name: settings.businessName, url: absoluteUrl("/"), ...(settings.email || settings.phone ? { contactPoint: [{ "@type": "ContactPoint", contactType: "customer service", ...(settings.email ? { email: settings.email } : {}), ...(settings.phone ? { telephone: settings.phone } : {}) }] } : {}), ...(settings.address || settings.city ? { address: { "@type": "PostalAddress", ...(settings.address ? { streetAddress: settings.address } : {}), ...(settings.city ? { addressLocality: settings.city } : {}) } } : {}) },
      { "@type": "WebSite", "@id": `${absoluteUrl("/")}#website`, url: absoluteUrl("/"), name: settings.businessName, publisher: { "@id": `${absoluteUrl("/")}#organization` } },
      { "@type": "OfferCatalog", name: `${settings.businessName} packages`, itemListElement: packages.map((item) => ({ "@type": "Offer", name: item.name, description: item.description, price: item.price, priceCurrency: currency, url: absoluteUrl("/#packages") })) },
    ],
  };

  return (
    <div className="pb-16">
      <SiteHeader businessName={settings.businessName} />
      <JsonLd data={structuredData} />
      <main className="container-shell space-y-20 py-10">
        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div className="space-y-6"><Badge className="bg-amber-100 text-amber-900">Celebrations designed, packed, and delivered beautifully</Badge><h1 className="max-w-3xl text-5xl leading-tight text-[var(--foreground)] md:text-7xl">Tent, decor, catering, lighting, and event packaging for moments that feel unforgettable.</h1><p className="max-w-2xl text-lg leading-8 text-[var(--muted)]">{settings.businessName} is ready to help you shape weddings, birthdays, corporate events, and parties. Browse the current catalog and send a booking request without creating an account.</p><div className="flex flex-wrap gap-3"><Link href="/customer/bookings/new"><Button size="lg">Book Your Event</Button></Link><Link href="/#packages"><Button variant="outline" size="lg">Explore Packages</Button></Link></div><div className="grid gap-4 sm:grid-cols-3">{[{ label: "Available packages", value: packages.length.toString() }, { label: "Active services", value: serviceCount.toString() }, { label: "Booking flow", value: "Fast request" }].map((item) => <Card key={item.label} className="glass-panel border-[var(--line)] bg-[var(--card)]"><CardContent className="space-y-1 p-5"><p className="text-sm text-[var(--muted)]">{item.label}</p><p className="text-xl font-semibold text-[var(--foreground)]">{item.value}</p></CardContent></Card>)}</div></div>
          <div className="grid-pattern rounded-[36px] border border-[var(--line)] p-5"><div className="overflow-hidden rounded-[28px] bg-[var(--surface)] p-5 shadow-2xl">{heroImage ? <Image src={heroImage} alt="Featured event setup" width={1200} height={900} sizes="(min-width: 1024px) 40vw, 100vw" className="h-80 w-full rounded-[24px] object-cover" priority /> : <div className="flex h-80 items-center justify-center rounded-[24px] bg-[var(--card)] text-center text-[var(--muted)]"><div><Sparkles className="mx-auto h-10 w-10 text-amber-600" /><p className="mt-3 font-semibold">Your showcase image will appear here</p><p className="mt-1 text-sm">Upload a package image from the admin panel.</p></div></div>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-[24px] bg-[var(--card)] p-4"><p className="text-sm text-[var(--muted)]">Curated event styling</p><p className="mt-2 text-xl font-semibold text-[var(--foreground)]">From intimate functions to large-format wedding grounds.</p></div><div className="rounded-[24px] bg-amber-400 p-4 text-stone-950"><p className="text-sm">Flexible packages</p><p className="mt-2 text-xl font-semibold">Choose a ready-made package or mix custom services to fit your budget.</p></div></div></div></div>
        </section>

        <section id="categories" className="space-y-6"><div><p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Event Categories</p><h2 className="text-4xl text-[var(--foreground)]">Built for the events your team serves.</h2></div><div className="grid gap-4 md:grid-cols-4">{categories.map(({ name, icon: Icon, description }) => <Card key={name} className="border-[var(--line)] bg-[var(--card)]"><CardContent className="space-y-4 p-6"><Icon className="h-8 w-8 text-amber-600" /><h3 className="text-2xl text-[var(--foreground)]">{name}</h3><p className="text-sm leading-7 text-[var(--muted)]">{description}</p></CardContent></Card>)}</div></section>

        <section id="packages" className="space-y-6"><div><p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Featured Packaging</p><h2 className="text-4xl text-[var(--foreground)]">Package options that feel premium before the event even starts.</h2></div>{packages.length === 0 ? <Card><CardContent className="p-8 text-center"><ShoppingBagIcon /><h3 className="mt-4 text-2xl font-semibold">Packages are being prepared</h3><p className="mx-auto mt-2 max-w-lg text-[var(--muted)]">The administrator has not published a package yet. You can still send a custom service request.</p><Link href="/customer/bookings/new" className="mt-5 inline-block"><Button>Request a custom plan</Button></Link></CardContent></Card> : <Carousel items={packages} renderItem={(item) => <Card className="border-[var(--line)] bg-[var(--card)]"><div className="grid gap-0 lg:grid-cols-[1fr_0.95fr]"><div className="p-3">{item.image ? <Image src={item.image} alt={item.name} width={1200} height={900} sizes="(min-width: 1024px) 45vw, 100vw" className="h-full min-h-80 w-full rounded-[28px] object-cover" /> : <div className="flex min-h-80 items-center justify-center rounded-[28px] bg-[var(--surface)] text-[var(--muted)]">No package image</div>}</div><CardContent className="flex flex-col justify-center space-y-5 p-8"><Badge className="w-fit bg-amber-100 text-amber-900">{item.name}</Badge><p className="text-4xl text-[var(--foreground)]">{formatCurrency(item.price, currency)}</p><p className="text-[var(--muted)]">{item.description}</p><div className="space-y-2 text-sm text-[var(--foreground)]"><p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-amber-500" /> Package details confirmed by your team</p><p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-amber-500" /> Flexible add-ons for your event</p></div></CardContent></div></Card>} />}</section>

        <section id="gallery" className="space-y-6"><div><p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Gallery</p><h2 className="text-4xl text-[var(--foreground)]">A look at the experiences you publish.</h2></div>{galleryImages.length === 0 ? <Card><CardContent className="p-8 text-center text-[var(--muted)]">Upload package images from the admin panel to publish your gallery here.</CardContent></Card> : <Carousel items={galleryImages} renderItem={(item) => <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-3 shadow-sm"><Image src={item.src} alt={`${item.name} event setup`} width={1200} height={900} sizes="(min-width: 768px) 80vw, 100vw" className="h-[28rem] w-full rounded-[24px] object-cover" /></div>} />}</section>

        <section id="contact" className="rounded-[36px] border border-[var(--line)] bg-[var(--surface)] p-8 md:p-12"><div className="grid gap-8 lg:grid-cols-[1fr_0.8fr]"><div className="space-y-4"><p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Contact</p><h2 className="text-4xl text-[var(--foreground)]">Ready to plan your event?</h2><p className="max-w-xl text-[var(--muted)]">Tell us your event type, date, location, guest count, and preferred package. We will review your request and get back with the next steps.</p><Link href="/customer/bookings/new"><Button size="lg">Send Booking Request</Button></Link></div><div className="grid gap-4 rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 text-sm text-[var(--foreground)]">{hasContact ? <>{settings.email ? <p>Email: {settings.email}</p> : null}{settings.phone ? <p>Phone: {settings.phone}</p> : null}{settings.address || settings.city ? <p>Address: {[settings.address, settings.city].filter(Boolean).join(", ")}</p> : null}</> : <p className="text-[var(--muted)]">Business contact details will appear here once an administrator saves them in Settings.</p>}<div className="mt-2 flex flex-wrap gap-3 border-t border-[var(--line)] pt-4"><Link href="/customer/bookings/new"><Button size="sm">Start a request</Button></Link><Link href="/customer/access"><Button size="sm" variant="outline">Join the team</Button></Link></div></div></div></section>
      </main>
    </div>
  );
}

function ShoppingBagIcon() {
  return <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><Sparkles className="h-7 w-7" /></span>;
}
