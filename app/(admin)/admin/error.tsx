"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="flex min-h-[60vh] items-center justify-center"><div className="max-w-md text-center"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-red-700">Workspace error</p><h1 className="mt-3 text-3xl font-semibold">We couldn&apos;t load that admin action.</h1><p className="mt-3 text-[var(--muted)]">Refresh the workspace and try again. If the problem continues, check the database and Clerk configuration.</p><Button className="mt-6" onClick={reset}>Try again</Button></div></main>;
}
