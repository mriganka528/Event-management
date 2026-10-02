"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/marketing/theme-toggle";

export function SiteHeader({ businessName = "Event Management" }: { businessName?: string }) {
  return (
    <header className="container-shell sticky top-3 z-40 pt-3 sm:top-4 sm:pt-4">
      <div className="glass-panel flex items-center justify-between gap-3 rounded-3xl border border-[var(--line)] px-3 py-2.5 shadow-sm sm:rounded-full sm:px-5 sm:py-3">
        <Link href="/" className="shrink-0 text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">{businessName || "Event Management"}</Link>
        <nav className="hidden items-center gap-5 text-sm text-[var(--muted)] md:flex lg:gap-6">
          <Link className="transition hover:text-[var(--foreground)]" href="/#categories">Categories</Link>
          <Link className="transition hover:text-[var(--foreground)]" href="/packages">Packages</Link>
          <Link className="transition hover:text-[var(--foreground)]" href="/services">Services</Link>
          <Link className="transition hover:text-[var(--foreground)]" href="/#gallery">Gallery</Link>
          <Link className="transition hover:text-[var(--foreground)]" href="/contact">Contact</Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/customer/bookings/new" className="inline-flex h-10 items-center gap-1 rounded-full bg-amber-500 px-3 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 sm:px-4 sm:text-sm">Book <ArrowRight className="h-3.5 w-3.5" /></Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
