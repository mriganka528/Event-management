import * as React from "react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--line-strong)] bg-[var(--input)] accent-[var(--brand)] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_30%,transparent)]",
        className,
      )}
      {...props}
    />
  ),
);

Checkbox.displayName = "Checkbox";
