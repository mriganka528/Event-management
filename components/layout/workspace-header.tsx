"use client";

import { useEffect, useState, type ReactNode } from "react";
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={cn("flex items-center justify-between gap-2 sm:gap-3", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">{brand}</div>

      <div className="flex shrink-0 items-center gap-2">
        {primary}
        {utility}
        {/*
          The account control sits in the bar from `sm` up. Below that it is
          behind the disclosure, where it is stacked rather than squeezed.
        */}
        <div className="hidden sm:block">{menu}</div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="workspace-menu"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] sm:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default sm:hidden"
          />
          <div
            id="workspace-menu"
            className="absolute inset-x-0 top-full z-50 border-b border-[var(--line)] bg-[var(--card)] p-4 shadow-xl sm:hidden"
          >
            <div className="flex flex-col gap-3">{menu}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
