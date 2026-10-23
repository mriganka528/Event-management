"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  ...props
}: ButtonProps & {
  /**
   * What the button says while the action runs. Invoice generation and PDF
   * preparation can take a few seconds on a cold database, and a generic
   * "Saving…" left people unsure whether the click had registered.
   */
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disableAutoPending disabled={pending || props.disabled} {...props}>
      {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
