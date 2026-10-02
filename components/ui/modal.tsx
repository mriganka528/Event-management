"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Modal({
  title,
  triggerLabel,
  children,
  className,
}: {
  title: string;
  triggerLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>{triggerLabel}</Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 p-2 sm:p-4">
          <div className={cn("max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl sm:p-6", className)}>
            <div className="mb-5 flex items-center justify-between gap-4">
              <h3 className="text-2xl text-[var(--foreground)]">{title}</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-[var(--line)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-muted)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}

