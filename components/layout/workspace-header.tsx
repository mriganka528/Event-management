"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The bar at the top of the customer and staff workspaces.
 *
 * Both workspaces had the same problem: the brand, the account control, and
 * the theme switch were laid out in a single flex row that had nowhere to go
 * on a phone. The row wrapped at an arbitrary point — sometimes between the
 * business name and the account chip, sometimes in the middle of the account
 * chip — so the bar changed height depending on how long the business name
 * happened to be.
 *
 * The bar is now one row that never wraps, and it is built out of three
 * deliberate parts rather than one undifferentiated row:
 *
 *  - the brand, which is always visible and is the one part allowed to
 *    shrink, because a long business name must not push the controls off the
 *    screen;
 *  - the primary action and the utility controls, which are always visible
 *    and never shrink, because they are the things somebody came to use;
 *  - the account control, which is in the bar from `sm` up and behind a
 *    labelled disclosure below it, where it has room for its name and its
 *    sign-out button.
 *
 * The phone disclosure is a floating card rather than a strip bolted to the
 * bottom of the header. It has its own scroll container, a backdrop, and a
 * close control inside the card, so a long account menu cannot run off the
 * bottom of a short screen or leave the reader with no way back.
 */
export function WorkspaceHeader({
  brand,
  primary,
  utility,
  menu,
  className,
}: {
  /** The logo and the business name. Always visible. */
  brand: ReactNode;
  /** The main action of the area. Always visible, in the bar itself. */
  primary?: ReactNode;
  /** Small controls such as the theme switch. Always visible. */
  utility?: ReactNode;
  /** The account control. In the bar from `sm` up, behind a disclosure below. */
  menu?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => toggleRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };
    // A click anywhere other than the toggle and its panel dismisses the
    // disclosure — including the other controls in the bar. The transparent
    // backdrop below catches the page area; this listener also covers anything
    // painted above it.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (toggleRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      closeMenu();
    };

    const media = window.matchMedia("(min-width: 640px)");
    const onBreakpoint = () => {
      if (media.matches) setOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    media.addEventListener("change", onBreakpoint);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      media.removeEventListener("change", onBreakpoint);
    };
  }, [open, closeMenu]);

  // Move focus into the panel when it opens. The trigger stays visible above
  // the backdrop, so returning focus to it on close is predictable.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      {/* Above the backdrop, so the menu button remains available as a second
          way to close the panel. */}
      <div className="relative z-50 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{brand}</div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {primary}
          {utility}
          {/*
            The account control sits in the bar from `sm` up. Below that it is
            behind the disclosure, where it is stacked rather than squeezed.
          */}
          <div className="hidden sm:block">{menu}</div>
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="workspace-menu"
            aria-haspopup="dialog"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] sm:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => closeMenu(true)}
            className="fixed inset-0 z-40 cursor-default bg-transparent sm:hidden"
          />
          <div
            ref={panelRef}
            id="workspace-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace menu"
            tabIndex={-1}
            onClick={(event) => {
              // A link inside the account card navigates away; do not leave the
              // panel standing open over the next page.
              if (event.target instanceof Element && event.target.closest("a")) closeMenu();
            }}
            className="absolute inset-x-0 top-[calc(100%+0.9rem)] z-50 max-h-[min(34rem,calc(100dvh-5.5rem))] overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-3 shadow-[0_24px_70px_rgba(61,40,14,0.25)] outline-none sm:hidden"
          >
            <div className="mb-2 flex items-center justify-between gap-3 px-2 pt-1">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">Workspace menu</p>
                <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">Account and shortcuts</p>
              </div>
              <button
                type="button"
                onClick={() => closeMenu(true)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Close menu</span>
              </button>
            </div>
            <div className="flex flex-col gap-3">{menu}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
