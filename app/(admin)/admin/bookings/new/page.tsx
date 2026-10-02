import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBookingFormData } from "@/lib/bookings";
import { BookingForm } from "@/components/booking/booking-form";

export const dynamic = "force-dynamic";

export default async function AdminNewBookingPage() {
  const { services, packages } = await getBookingFormData();
  return (
    <main className="space-y-7">
      <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to bookings</Link>
      <div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Operations intake</p><h1 className="mt-2 text-4xl font-semibold">Create a booking</h1><p className="mt-2 max-w-2xl text-[var(--muted)]">Record a phone or walk-in enquiry using the same pricing and inventory workflow as the public request form.</p></div>
      <BookingForm services={services.map((service) => ({ id: service.id, name: service.name, slug: service.slug, basePrice: Number(service.basePrice), unitLabel: service.unitLabel, pricingMode: service.pricingMode }))} packages={packages.map((item) => ({ id: item.id, name: item.name, description: item.description, price: Number(item.price), imageUrl: item.imageUrl, packageServices: item.packageServices.map((service) => ({ serviceId: service.serviceId })) }))} catalogReady={services.length > 0 || packages.length > 0} />
    </main>
  );
}
