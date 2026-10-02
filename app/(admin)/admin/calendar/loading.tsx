import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a different month streams in, so the navigation never looks
 * like nothing happened between the click and the new grid.
 */
export default function CalendarLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span role="status" aria-live="polite" className="sr-only">
        Loading calendar
      </span>

      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full max-w-md sm:h-12" />
          <Skeleton className="h-5 w-full max-w-xl" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-20 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </section>

      <div className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-7 w-16 rounded-full" />)}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-4 w-full" />)}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, index) => (
            <Skeleton key={index} className="min-h-32 rounded-2xl" />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-56 rounded-[28px]" />
        ))}
      </div>
    </div>
  );
}
