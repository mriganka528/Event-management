import { LoaderCircle } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}

function SiteHeaderSkeleton() {
  return (
    <div className="container-shell pt-3 sm:pt-4">
      <div className="flex items-center justify-between rounded-full border border-[var(--line)] bg-[var(--card)] px-5 py-3">
        <Skeleton className="h-5 w-36" />
        <div className="hidden gap-5 md:flex">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-4 w-16" />)}
        </div>
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function PublicPageSkeleton() {
  return (
    <div className="min-h-screen pb-16" aria-busy="true">
      <LoadingStatus label="Loading page" />
      <SiteHeaderSkeleton />
      <main className="container-shell space-y-16 py-12">
        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div className="space-y-5">
            <Skeleton className="h-7 w-72 rounded-full" />
            <Skeleton className="h-16 w-full max-w-3xl" />
            <Skeleton className="h-6 w-full max-w-2xl" />
            <Skeleton className="h-6 w-4/5 max-w-2xl" />
            <div className="flex gap-3 pt-3"><Skeleton className="h-12 w-36" /><Skeleton className="h-12 w-40" /></div>
          </div>
          <Skeleton className="h-[28rem] rounded-[36px]" />
        </section>
        <CatalogGridSkeleton />
      </main>
    </div>
  );
}

export function CatalogPageSkeleton({ items = 6 }: { items?: number }) {
  return (
    <div className="min-h-screen" aria-busy="true">
      <LoadingStatus label="Loading catalog" />
      <SiteHeaderSkeleton />
      <main className="container-shell space-y-10 py-12">
        <div className="space-y-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-14 max-w-3xl" />
          <Skeleton className="h-6 max-w-2xl" />
        </div>
        <CatalogGridSkeleton items={items} />
      </main>
    </div>
  );
}

function CatalogGridSkeleton({ items = 6 }: { items?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: items }, (_, index) => (
        <div key={index} className="space-y-4 rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6">
          <Skeleton className="h-40 w-full rounded-[24px]" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

export function ContactPageSkeleton() {
  return (
    <div className="min-h-screen" aria-busy="true">
      <LoadingStatus label="Loading contact details" />
      <SiteHeaderSkeleton />
      <main className="container-shell space-y-8 py-12">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-16 max-w-3xl" />
          <Skeleton className="h-6 max-w-2xl" />
          <Skeleton className="h-12 w-56" />
        </div>
        <div className="max-w-2xl space-y-5 rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-6 w-full" />)}
        </div>
      </main>
    </div>
  );
}

export function WorkspacePageSkeleton({ formHeavy = false }: { formHeavy?: boolean }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <LoadingStatus label="Loading workspace" />
      <Skeleton className="h-48 rounded-[32px]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-[28px]" />)}
      </div>
      {formHeavy ? (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <Skeleton className="h-[34rem] rounded-[32px]" />
          <Skeleton className="h-[28rem] rounded-[32px]" />
        </div>
      ) : (
        <Skeleton className="h-[30rem] rounded-[32px]" />
      )}
    </div>
  );
}

export function InvoicePageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-44 rounded-full" />
      </div>
      <p className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status" aria-live="polite">
        <LoaderCircle className="h-4 w-4 animate-spin text-[var(--brand-dark)]" aria-hidden="true" />
        Preparing your invoice…
      </p>
      <div className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-5 sm:p-8">
        <div className="flex flex-col gap-6 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="space-y-3 sm:text-right">
            <Skeleton className="h-8 w-36 sm:ml-auto" />
            <Skeleton className="h-4 w-44 sm:ml-auto" />
            <Skeleton className="h-4 w-28 sm:ml-auto" />
          </div>
        </div>
        <div className="grid gap-6 py-6 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-52 max-w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-6 border-b border-[var(--line)] pb-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="ml-auto mt-6 w-full max-w-xs space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}

export function PublicDetailPageSkeleton() {
  return (
    <div className="min-h-screen pb-16" aria-busy="true">
      <LoadingStatus label="Loading details" />
      <SiteHeaderSkeleton />
      <main className="container-shell py-12">
        <DetailPageSkeleton />
      </main>
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <LoadingStatus label="Loading details" />
      <Skeleton className="h-5 w-32" />
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-[4/3] rounded-[32px]" />
        <div className="space-y-5 py-6">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
      <Skeleton className="h-72 rounded-[32px]" />
    </div>
  );
}

export function FullPageSkeleton() {
  return (
    <div className="container-shell min-h-[70vh] space-y-8 py-12" aria-busy="true">
      <LoadingStatus label="Loading page" />
      <div className="space-y-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-14 max-w-2xl" />
        <Skeleton className="h-5 max-w-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-96 rounded-[32px] lg:col-span-2" />
        <Skeleton className="h-96 rounded-[32px]" />
      </div>
    </div>
  );
}
