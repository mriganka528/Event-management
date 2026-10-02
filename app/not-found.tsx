import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return <main className="flex min-h-screen items-center justify-center px-4 py-16"><div className="max-w-lg text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-100 text-amber-800"><SearchX className="h-8 w-8" /></span><p className="mt-6 text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Page not found</p><h1 className="mt-3 text-4xl font-semibold">That page took a wrong turn.</h1><p className="mt-4 text-[var(--muted)]">The link may be outdated, or the event may no longer be available.</p><Link href="/"><Button className="mt-7"><ArrowLeft className="mr-2 h-4 w-4" />Back to home</Button></Link></div></main>;
}
