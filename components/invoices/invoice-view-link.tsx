"use client";

import Link, { useLinkStatus } from "next/link";
import { Eye, LoaderCircle } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type InvoiceViewLinkProps = {
  href: string;
  label?: string;
  pendingLabel?: string;
  variant?: "default" | "secondary" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
};

/**
 * The invoice is a server-rendered page on a remote database, so the click can
 * take a moment. `useLinkStatus` is the one signal that knows the navigation is
 * still in flight; it must be read in a child of `Link`, which is why the label
 * is a separate component rather than a hook call in the link itself.
 */
function InvoiceLinkLabel({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useLinkStatus();

  return (
    <span className="inline-flex items-center gap-2" aria-live="polite">
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
      {pending ? pendingLabel : label}
    </span>
  );
}

export function InvoiceViewLink({
  href,
  label = "View invoice",
  pendingLabel = "Opening invoice…",
  variant = "outline",
  size = "sm",
  className,
}: InvoiceViewLinkProps) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)}>
      <InvoiceLinkLabel label={label} pendingLabel={pendingLabel} />
    </Link>
  );
}
