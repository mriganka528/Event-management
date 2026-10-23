import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays, CreditCard, FileText, Package, ShieldCheck, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: "The terms that apply when you request a quote, confirm a booking, and make a payment with us.",
  alternates: { canonical: absoluteUrl("/terms") },
  openGraph: {
    title: "Terms and conditions",
    description: "The terms that apply when you request a quote, confirm a booking, and make a payment with us.",
    url: absoluteUrl("/terms"),
  },
};

/**
 * The terms, read from the business profile where the page can.
 *
 * The company name, contact details, and tax rate come from the settings the
 * team maintains, so the page cannot drift from the business it describes.
 */
const SECTIONS = [
  {
    icon: FileText,
    title: "About this agreement",
    body: [
      "These terms apply to every quote, booking, and payment we handle. By sending a booking request, booking a date with us, or paying an invoice, you agree to them.",
      "A booking request is not a booking. It is a request for a proposal, and it becomes a confirmed booking only when our team approves it and sends you the invoice.",
    ],
  },
  {
    icon: CalendarDays,
    title: "Dates, venues, and changes",
    body: [
      "The dates you send us are the dates you are asking to hold. We confirm the date, the venue, and the guest count in writing before anything is final, and an event that runs across more than one day is charged and resourced for each of those days.",
      "A confirmed booking can be cancelled from your dashboard while it is still a request, and cancelling frees the date immediately. Once we have approved a booking we have committed stock, staff, and a calendar slot, so changes are handled by our team rather than from the dashboard.",
      "If we cannot deliver a confirmed booking — stock gone, the venue unavailable, or anything else within our control — we refund what you have paid for it.",
    ],
  },
  {
    icon: Package,
    title: "What the quote includes",
    body: [
      "A quote covers the services and quantities listed on it, for the dates and guest count it was priced for. Changing the date, the guest count, or the services changes the price, and we will send you the revised quote before you pay it.",
      "Prices are exclusive of tax unless the quote says otherwise. The tax rate shown on your invoice is the rate that applied when the booking was approved.",
      "Images on this site are representative of our work and of the services we offer. They are not a guarantee that a particular item will look identical at your event.",
    ],
  },
  {
    icon: CreditCard,
    title: "Payments",
    body: [
      "We ask for an advance, part payment, or the full balance depending on what is booked, and we tell you which we are asking for. The amount is shown on your invoice and in your dashboard, and it is the amount we take.",
      "Online payments are handled by our payment provider. We never see or store your card details.",
      "A cash payment counts as paid only once our team has confirmed that the cash has been received. Declaring a cash payment is a claim, not a payment, and it does not change your balance until it is approved.",
      "Payments are not refundable once they have been applied to a confirmed booking, except where the booking itself cannot be delivered or a service cannot be provided, in which case we refund the amount paid for it.",
    ],
  },
  {
    icon: Users,
    title: "Your details",
    body: [
      "We use the contact details you give us to prepare your quote, send your invoice, and reach you about the event. We do not sell or share them.",
      "You are responsible for the accuracy of the details you send, particularly the phone number and the email address the invoice goes to. A booking request with a wrong address or number is a request we cannot deliver, and we cannot be held to it.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Cancellations and refunds",
    body: [
      "A request can be cancelled from your dashboard until we approve it, and the date is freed the moment you do.",
      "A confirmed booking can only be changed or cancelled by our team, because it already holds stock, staff, and a calendar slot. Contact us and we will tell you what the position is.",
      "Where a confirmed booking is cancelled by us, or a service on it cannot be provided, the amount paid for it is refunded to the card or account it was paid from.",
      "Where a confirmed booking is cancelled by you, the amount paid is not refundable, because the stock and the crew it held cannot be sold on.",
    ],
  },
];

export default async function TermsPage() {
  const settings = await prisma.businessSetting
    .findUnique({ where: { id: "default" }, select: { businessName: true, email: true, phone: true, address: true, city: true, logoUrl: true } })
    .catch(() => null);
  const businessName = settings?.businessName || "Event Management";

  return (
    <>
      <SiteHeader businessName={businessName} logoUrl={settings?.logoUrl ?? null} />
      <main className="container-shell space-y-10 py-12">
        <div className="max-w-3xl space-y-5">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
            <ArrowLeft className="h-4 w-4" />Back to home
          </Link>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Legal</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Terms and conditions</h1>
          <p className="text-lg leading-8 text-[var(--muted)]">
            These terms apply to every quote, booking, and payment handled by {businessName}. They are written to be read — if anything here is unclear, ask us before you book.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {SECTIONS.map(({ icon: Icon, title, body }) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Icon className="h-5 w-5 shrink-0 text-amber-700" />
                    {title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {body.map((paragraph) => (
                    <p key={paragraph} className="leading-7 text-[var(--muted)]">
                      {paragraph}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-xl">Your booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-[var(--muted)]">
                Send us your date, venue, and guest count, and we will send a clear quote you can act on.
              </p>
              <Link href="/customer/bookings/new" className="block">
                <Button className="w-full">Request a booking quote</Button>
              </Link>
              {settings?.email || settings?.phone || settings?.address || settings?.city ? (
                <div className="space-y-1 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
                  <p className="font-semibold text-[var(--foreground)]">{businessName}</p>
                  {settings.email ? <p className="break-all">{settings.email}</p> : null}
                  {settings.phone ? <p>{settings.phone}</p> : null}
                  {settings.address || settings.city ? (
                    <p className="break-words">{[settings.address, settings.city].filter(Boolean).join(", ")}</p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
