import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Every table in the app sits inside an `overflow-x-auto` container, which makes
 * it safe to put a width floor on the element itself.
 *
 * Without one, the auto layout has to fit every column inside the viewport and
 * squeezes them until short words break mid-word — "category" rendered as
 * "cate" / "gory". With a floor the container scrolls sideways instead and each
 * column keeps the width its content actually needs. A page with more columns
 * raises the floor with `className`, which tailwind-merge lets win.
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-[40rem] caption-bottom text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-[var(--line)]", className)} {...props} />;
}

// Headings are one or two short words and never need to wrap.
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-12 px-4 text-left font-medium whitespace-nowrap text-[var(--muted)]", className)} {...props} />;
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("p-4 align-middle text-[var(--muted-strong)]", className)} {...props} />;
}
