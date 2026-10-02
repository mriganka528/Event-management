"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A submit button for short, inline action forms (archive, delete, mark read,
 * approve/decline, etc.). While the server action is running it is disabled and
 * shows a spinner, but keeps its original label so the row does not jump.
 */
export function ActionSubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disableAutoPending disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}
