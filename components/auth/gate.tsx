import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, ShieldCheck, Hourglass, KeyRound, ArrowLeft, RefreshCw } from "lucide-react";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { getAuthContext, HOME_BY_ROLE } from "@/lib/auth/server";
import { maxDevices } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for every post-sign-in gate. It deliberately exposes no
 * application data: only the decision, the reason, and the next action.
 *
 * All colours come from the tokens in `app/globals.css` so the screens follow
 * the active light/dark theme.
 */

export type GateTone = "pending" | "denied" | "mfa" | "password";

const TONE = {
  pending: {
    panel: "bg-[var(--warning-soft)] border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)]",
    icon: "bg-[var(--warning-soft)] text-[var(--warning-text)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--warning-text)_25%,transparent)]",
    heading: "text-[var(--warning-text)]",
    Icon: Hourglass,
  },
  denied: {
    panel: "bg-[var(--danger-soft)] border-[color:color-mix(in_srgb,var(--danger-text)_28%,transparent)]",
    icon: "bg-[var(--danger-soft)] text-[var(--danger-text)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--danger-text)_25%,transparent)]",
    heading: "text-[var(--danger-text)]",
    Icon: ShieldAlert,
  },
  mfa: {
    panel: "bg-[var(--info-soft)] border-[color:color-mix(in_srgb,var(--info-text)_28%,transparent)]",
    icon: "bg-[var(--info-soft)] text-[var(--info-text)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--info-text)_25%,transparent)]",
    heading: "text-[var(--info-text)]",
    Icon: KeyRound,
  },
  password: {
    panel: "bg-[var(--info-soft)] border-[color:color-mix(in_srgb,var(--info-text)_28%,transparent)]",
    icon: "bg-[var(--info-soft)] text-[var(--info-text)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--info-text)_25%,transparent)]",
    heading: "text-[var(--info-text)]",
    Icon: KeyRound,
  },
} as const;

const GATE_METADATA: Record<GateTone, Metadata> = {
  pending: { title: "Awaiting approval", robots: { index: false, follow: false, nocache: true } },
  denied: { title: "Access denied", robots: { index: false, follow: false, nocache: true } },
  mfa: { title: "Two-factor authentication required", robots: { index: false, follow: false, nocache: true } },
  password: { title: "Set up two-factor authentication", robots: { index: false, follow: false, nocache: true } },
};

export function gateMetadata(tone: GateTone): Metadata {
  return GATE_METADATA[tone];
}

export function GateShell({
  tone,
  heading,
  message,
  bullets,
  children,
  showSignOut = true,
  extraAction,
}: {
  tone: GateTone;
  heading: string;
  message: string;
  bullets: readonly string[];
  children?: React.ReactNode;
  showSignOut?: boolean;
  extraAction?: React.ReactNode;
}) {
  const styles = TONE[tone];
  const Icon = styles.Icon;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Access control</p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {showSignOut ? (
              <SignOutForm />
            ) : null}
          </div>
        </div>

        <section className={cn("rounded-[32px] border p-6 shadow-sm sm:p-9", styles.panel)}>
          <span className={cn("inline-flex h-14 w-14 items-center justify-center rounded-2xl", styles.icon)}>
            <Icon className="h-7 w-7" />
          </span>
          <h1 className={cn("mt-5 text-3xl font-semibold tracking-tight sm:text-4xl", styles.heading)}>{heading}</h1>
          <p className="mt-3 text-[var(--muted-strong)]">{message}</p>
          <GateList items={bullets} />
          {children}
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {extraAction}
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />Back to home
            </Button>
          </Link>
        </div>

        <p className="mt-6 text-xs leading-5 text-[var(--muted)]">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
          Every sign-in, code attempt, and access decision is recorded in the security log. Accounts may be signed in on {maxDevices()} devices at a time.
        </p>
      </div>
    </main>
  );
}

export function GateList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-6 grid gap-2 text-sm text-[var(--muted-strong)]">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function GateNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 flex items-start gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card-elevated)] px-4 py-3 text-sm text-[var(--muted-strong)]">
      <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Resolves the caller's access state and renders the matching gate, redirecting
 * to the right screen when the visitor is actually allowed in. Every gate page
 * calls this so none of them can drift into showing the wrong decision.
 */
export async function renderGate(options: {
  allowed: (context: Awaited<ReturnType<typeof getAuthContext>>["state"], user: Awaited<ReturnType<typeof getAuthContext>>["user"]) => string | null;
  homePath?: (user: NonNullable<Awaited<ReturnType<typeof getAuthContext>>["user"]>) => string;
}) {
  const context = await getAuthContext();

  if (context.state === "UNAUTHENTICATED") {
    if (context.awaitingTwoFactor) redirect("/verify-two-factor");
    redirect("/sign-in");
  }

  if (context.reason === "must-set-password") redirect("/activate");
  if (context.state === "MFA_REQUIRED") redirect("/two-factor-setup");

  const user = context.user!;
  const destination = options.allowed(context.state, user);
  if (destination === null) return { context, user };

  // Allowed, so send them where they were actually headed.
  if (context.state === "ACTIVE") {
    redirect(options.homePath ? options.homePath(user) : HOME_BY_ROLE[user.role]);
  }
  return { context, user };
}
