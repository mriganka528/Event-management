"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { usePendingForm } from "@/components/forms/pending-form-context";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-amber-500 text-stone-950 hover:bg-amber-400",
        secondary: "bg-stone-900 text-stone-50 hover:bg-stone-800",
        outline: "border border-[var(--line-strong)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
        ghost: "text-stone-700 hover:bg-stone-100",
        destructive: "bg-red-600 text-white hover:bg-red-500",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Set by wrapper components (SubmitButton, ActionSubmitButton) that already
   * render their own spinner, so the auto-pending spinner is not duplicated.
   */
  disableAutoPending?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type, disabled, disableAutoPending, children, ...props }, ref) => {
    // A button with no explicit type defaults to submit, so while the action
    // form is processing, any submit control inside it shows a spinner and is
    // disabled to prevent double submits.
    const formPending = usePendingForm();
    const isSubmitControl = type === undefined || type === "submit";
    const busy = !disableAutoPending && formPending && isSubmitControl;

    return (
      <button
        type={type ?? "submit"}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

