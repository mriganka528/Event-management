import { LoaderCircle } from "lucide-react";

/**
 * Shown while a customer auth route is being prepared.
 *
 * These screens are dynamic and may wait on Clerk, so a blank gap was the first
 * thing a customer saw after pressing "Customer sign in". The card matches the
 * auth shell so the loading state does not jump into a different design, and
 * the message names the activity so the page never looks frozen.
 */
export default function CustomerAuthLoading() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[var(--background)] px-4 py-8 sm:px-6 sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[var(--brand-soft)] opacity-70 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-[var(--brand-softer)] blur-3xl" />
      </div>

      <div className="w-full max-w-md rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 text-center shadow-sm sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
        </span>
        <p className="mt-4 font-semibold text-[var(--foreground)]">Preparing your account</p>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]" role="status" aria-live="polite" aria-busy="true">
          Loading the secure sign-in form…
        </p>
        <div className="mt-5 space-y-3" aria-hidden="true">
          <div className="h-11 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-11 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-11 animate-pulse rounded-full bg-[var(--surface-muted)]" />
        </div>
      </div>
    </main>
  );
}
