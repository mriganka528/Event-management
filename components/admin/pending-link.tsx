"use client";

import Link, { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function PendingIndicator() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />;
}

/**
 * A navigation link that shows a spinner the moment it is clicked, so month
 * navigation never looks like it did nothing while the server component
 * streams the new month.
 */
export function PendingLink({
  href,
  className,
  active = false,
  label,
  children,
}: {
  href: string;
  className?: string;
  active?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "date" : undefined}
      className={cn("inline-flex items-center justify-center gap-2 transition", className)}
    >
      <PendingIndicator />
      {children}
    </Link>
  );
}
