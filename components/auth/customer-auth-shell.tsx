import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ReceiptText, ShieldCheck, TentTree } from "lucide-react";
import { ThemeToggle } from "@/components/marketing/theme-toggle";

/**
 * The frame shared by the customer sign-in and sign-up screens.
 *
 * The old screens were a bare column in the middle of the page: no branding, no
 * way back, and a form that sat on an empty background on a desktop. This keeps
 * the form column narrow enough for Clerk's widget, while using the extra width
 * on large screens for the things a customer is actually signing in for.
 *
 * Everything stacks on a phone. The side panel is hidden there rather than
 * squeezed above the form, so the sign-in field is still the first thing on the
 * screen and no horizontal scrolling is introduced at 320px.
 */
export function CustomerAuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-dvh items-center overflow-hidden bg-[var(--background)] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[var(--brand-soft)] opacity-70 blur-3xl sm:h-96 sm:w-96" />
        <div className="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-[var(--brand-softer)] blur-3xl sm:h-[30rem] sm:w-[30rem]" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-14 xl:gap-20">
        {/* Brand and reassurance. Hidden on small screens so the form stays first. */}
        <aside className="relative hidden min-h-[36rem] overflow-hidden rounded-[36px] border border-[var(--line)] bg-[linear-gradient(145deg,var(--brand-soft),var(--brand-softer)_48%,var(--card))] p-8 shadow-[0_30px_80px_-60px_rgba(53,41,26,0.6)] lg:flex lg:flex-col lg:justify-between xl:p-10">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full border border-[var(--line)] bg-[var(--brand-soft)] opacity-70" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-[var(--brand-softer)] opacity-90" />

          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--card)] text-[var(--brand-dark)] shadow-sm">
                <TentTree className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">Event Management</p>
                <p className="text-xs text-[var(--muted)]">Customer portal</p>
              </div>
            </div>

            <p className="mt-10 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-dark)]">
              Everything in one place
            </p>
            <h2 className="mt-3 max-w-md text-4xl leading-[1.08] tracking-tight text-[var(--foreground)] xl:text-[2.75rem]">
              Your event, from first idea to final invoice.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-[var(--muted-strong)]">
              Sign in to follow every request, keep your details current, and find the paperwork without digging
              through your inbox.
            </p>
          </div>

          <ul className="relative mt-10 grid gap-3">
            {BENEFITS.map(({ icon: Icon, title: benefitTitle, description: benefitDescription }) => (
              <li
                key={benefitTitle}
                className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5 shadow-sm"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--foreground)]">{benefitTitle}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{benefitDescription}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="relative mt-8 flex items-center gap-2 text-xs text-[var(--muted)]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Secure sign-in with Google or your email address.
          </p>
        </aside>

        <section className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/auth-choice"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3.5 text-sm font-medium text-[var(--foreground)] shadow-sm transition hover:bg-[var(--surface-muted)] sm:px-4"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Account options</span>
              <span className="sr-only sm:hidden">Back to account options</span>
            </Link>
            <ThemeToggle />
          </div>

          <header className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-dark)]">{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>
          </header>

          <div className="mt-6">{children}</div>
          {footer ? <div className="mt-5">{footer}</div> : null}
        </section>
      </div>
    </main>
  );
}

const BENEFITS = [
  {
    icon: CalendarDays,
    title: "Bookings in one place",
    description: "Track every request, date, and update from your dashboard.",
  },
  {
    icon: ReceiptText,
    title: "Invoices on demand",
    description: "Download receipts and payment records whenever you need them.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by design",
    description: "Sign in with Google or a verified email address.",
  },
] as const;
