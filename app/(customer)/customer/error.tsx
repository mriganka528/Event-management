"use client";

import { Button } from "@/components/ui/button";

export default function CustomerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-[60vh] items-center justify-center"><div className="max-w-md text-center"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-red-700">Customer workspace error</p><h1 className="mt-3 text-3xl font-semibold">Something needs another look.</h1><p className="mt-3 text-[var(--muted)]">Your booking data is safe. Refresh and try again.</p><Button className="mt-6" onClick={reset}>Try again</Button></div></main>;
}
