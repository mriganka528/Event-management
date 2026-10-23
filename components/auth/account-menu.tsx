"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Home,
  LayoutDashboard,
  LifeBuoy,
  Package2,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { cn } from "@/lib/utils";

export type AccountMenuIcon = "dashboard" | "calendar" | "search" | "package" | "home" | "help" | "sparkles";

export type AccountMenuLink = {
  href: string;
  label: string;
  description?: string;
  icon?: AccountMenuIcon;
};

const LINK_ICONS: Record<AccountMenuIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  search: Search,
  package: Package2,
  home: Home,
  help: LifeBuoy,
  sparkles: Sparkles,
};

function initialFor(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Links inside the account menu. They are plain data from the server layout —
 * an icon name rather than a component — so the menu can stay a Client
 * Component without passing functions across the server boundary.
 */
function AccountLinks({
  links,
  onNavigate,
  className,
}: {
  links: readonly AccountMenuLink[];
  onNavigate?: () => void;
  className?: string;
}) {
  if (links.length === 0) return null;

  return (
    <nav aria-label="Account shortcuts" className={cn("grid gap-1", className)}>
      {links.map(({ href, label, description, icon = "dashboard" }) => {
        const Icon = LINK_ICONS[icon] ?? LayoutDashboard;

        return (
          <Link
            key={`${href}-${label}`}
            href={href}
            onClick={onNavigate}
            className="group flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--foreground)]">{label}</span>
              {description ? <span className="block truncate text-xs text-[var(--muted)]">{description}</span> : null}
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The signed-in account control.
 *
 * On a phone it is an inline card, because the workspace bar already puts it
 * behind its own disclosure; nesting a second popover inside that disclosure
 * would be a menu opening inside a menu. From `sm` up it becomes a single
 * account button with a popover, which keeps the bar to one row even when the
 * business name is long.
 *
 * `compact` is kept for the admin sidebar, where the account sits in a narrow
 * footer and has no room for a popover.
 */
export function AccountMenu({
  name,
  roleLabel,
  compact = false,
  links = [],
}: {
  name: string;
  roleLabel: string;
  compact?: boolean;
  links?: readonly AccountMenuLink[];
}) {
  const displayName = name.trim() || "Your account";
  const initial = initialFor(displayName);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId().replaceAll(":", "");

  // A popover that stays open after the pointer has moved elsewhere is a menu
  // that has stopped listening. Escape also returns focus to the trigger.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // The trigger is hidden below `sm`, so an open popover must not survive a
  // resize into the phone layout.
  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia("(max-width: 639px)");
    const onChange = () => {
      if (media.matches) setOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [open]);

  // Move focus into the popover when it opens, so the links and sign-out are
  // reachable by keyboard without tabbing through the bar first.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-dark)]"
          title={`${displayName} (${roleLabel})`}
          aria-hidden="true"
        >
          {initial}
        </span>
        <SignOutForm />
      </div>
    );
  }

  return (
    <>
      {/* Phone: the workspace disclosure supplies the popover, so this content
          is laid out as a card and never stacks a second floating layer. */}
      <div className="sm:hidden">
        <div className="space-y-3">
          {/* On a 320px screen the name, role, and a labelled sign-out button
              cannot share one row; below 360px the sign-out gets its own full
              width row rather than truncating the account name to "Aar…". */}
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-3 min-[360px]:flex-row min-[360px]:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-base font-semibold text-[var(--brand-dark)]"
                aria-hidden="true"
              >
                {initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{displayName}</span>
                <span className="block truncate text-xs capitalize text-[var(--muted)]">{roleLabel}</span>
              </span>
            </div>
            <SignOutForm variant="outline" size="sm" className="w-full min-[360px]:w-auto" />
          </div>
          <AccountLinks
            links={links}
            className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-1"
          />
        </div>
      </div>

      {/* Tablet and up: one account button with a real popover. */}
      <div ref={containerRef} className="relative hidden sm:block">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-haspopup="dialog"
          className="group inline-flex h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pl-1 pr-2.5 text-left transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-dark)]"
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="hidden min-w-0 text-left md:block">
            <span className="block max-w-[9rem] truncate text-sm font-semibold leading-tight text-[var(--foreground)]">{displayName}</span>
            <span className="block max-w-[9rem] truncate text-[11px] capitalize leading-tight text-[var(--muted)]">{roleLabel}</span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="sr-only">{open ? "Close account menu" : "Open account menu"}</span>
        </button>

        {open ? (
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Account menu"
            tabIndex={-1}
            className="absolute right-0 top-[calc(100%+0.55rem)] z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-[26px] border border-[var(--line)] bg-[var(--card)] shadow-[0_24px_70px_rgba(61,40,14,0.22)] outline-none"
          >
            <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--brand-softer)] p-4">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-base font-semibold text-[var(--brand-dark)]"
                aria-hidden="true"
              >
                {initial}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{displayName}</span>
                <span className="block truncate text-xs capitalize text-[var(--muted)]">{roleLabel}</span>
              </span>
            </div>

            <AccountLinks links={links} onNavigate={() => setOpen(false)} className="p-2" />

            <div className="border-t border-[var(--line)] p-2">
              <SignOutForm
                variant="ghost"
                className="w-full justify-start rounded-2xl px-3 text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export { formatRoleLabel } from "@/lib/role-label";
