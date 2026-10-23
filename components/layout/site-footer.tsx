import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";

/**
 * The public footer.
 *
 * The public pages had no footer at all, which meant there was nowhere for a
 * visitor to find the terms, the contact details, or the business's address
 * once they had scrolled past the header. The terms in particular have to be
 * reachable: a customer agreeing to a quote is agreeing to terms they were
 * able to read.
 */
export function SiteFooter({
  businessName = "Event Management",
  email,
  phone,
  address,
  city,
}: {
  businessName?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-[var(--line)] bg-[var(--card)]">
      <div className="container-shell grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="text-lg font-semibold text-[var(--foreground)]">{businessName}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Tent, decor, catering, lighting, and event packaging for weddings, birthdays, corporate events, and
            celebrations.
          </p>
        </div>

        <nav aria-label="Explore">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Explore</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              { href: "/#categories", label: "Categories" },
              { href: "/packages", label: "Packages" },
              { href: "/services", label: "Services" },
              { href: "/#gallery", label: "Gallery" },
            ].map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-[var(--muted)] transition hover:text-[var(--foreground)]">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Company">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Company</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              { href: "/contact", label: "Contact" },
              { href: "/terms", label: "Terms and conditions" },
              { href: "/customer/bookings/new", label: "Request a quote" },
              { href: "/customer/dashboard", label: "My bookings" },
            ].map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-[var(--muted)] transition hover:text-[var(--foreground)]">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Get in touch</p>
          <ul className="mt-4 space-y-3 text-sm text-[var(--muted)]">
            {email ? (
              <li>
                <a href={`mailto:${email}`} className="flex items-start gap-2 transition hover:text-[var(--foreground)]">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-all">{email}</span>
                </a>
              </li>
            ) : null}
            {phone ? (
              <li>
                <a href={`tel:${phone}`} className="flex items-center gap-2 transition hover:text-[var(--foreground)]">
                  <Phone className="h-4 w-4 shrink-0" />
                  {phone}
                </a>
              </li>
            ) : null}
            {address || city ? (
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{[address, city].filter(Boolean).join(", ")}</span>
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--line)]">
        <div className="container-shell flex flex-col gap-2 py-5 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {businessName}. All rights reserved.
          </p>
          <p>Booking requests are confirmed by our team, not by this website.</p>
        </div>
      </div>
    </footer>
  );
}
