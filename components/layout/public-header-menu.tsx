"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { AccountAccess } from "@/components/layout/account-access";
import { usePublicAccount } from "@/components/layout/public-account-status";
import type { PublicNavItem } from "@/components/layout/site-header";

/**
 * Small-screen disclosure for the public header.
 *
 * The navigation used to be `hidden md:flex` with nothing replacing it below
 * `md`, so on a phone the bar offered a "Book" button and no route to Packages,
 * Services, Contact, or sign-in. This puts them behind an explicit, labelled
 * toggle.
 *
 * Closing on Escape and on navigation both matter: the panel overlays the page,
 * so leaving it open would cover the section the visitor just asked for.
 */
export function PublicHeaderMenu({ nav }: { nav: readonly PublicNavItem[] }) {
  const [open, setOpen] = useState(false);
  const account = usePublicAccount();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Any click outside the menu and its trigger closes it. The transparent
    // backdrop below catches most of these, but listening on the document also
    // covers clicks on elements that paint above the backdrop.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="public-header-menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--foreground)]"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            id="public-header-menu"
            className="glass-panel absolute right-0 top-12 z-50 w-[min(88vw,20rem)] rounded-3xl border border-[var(--line)] p-3 shadow-xl"
          >
            <nav className="grid gap-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-2xl px-3 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/customer/bookings/new"
                onClick={() => setOpen(false)}
                className="rounded-2xl px-3 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
              >
                Book an event
              </Link>
            </nav>

            <div className="mt-2 border-t border-[var(--line)] pt-3" onClick={() => setOpen(false)}>
              <AccountAccess {...account} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}