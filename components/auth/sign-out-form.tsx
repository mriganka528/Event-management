"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth-actions";
import { ACCOUNT_SIGNED_OUT_EVENT } from "@/lib/account-bootstrap";
import { Button, type ButtonProps } from "@/components/ui/button";

type SignOutFormProps = {
  /** Label shown when idle. */
  label?: string;
  /** Label shown while the server action runs, so the click is visibly accepted. */
  pendingLabel?: string;
  /**
   * Below `sm`, render the icon only with a screen-reader label. The customer
   * and staff bars have room for the word from `sm` up, but not on a phone.
   */
  iconOnlyOnMobile?: boolean;
  formClassName?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
};

/**
 * Sign-out control shared by every header and gate.
 *
 * Two problems made the old plain `<form action={signOutAction}>` feel broken:
 * the button gave no sign that anything was happening, and a sign-out performed
 * on a cached public page could navigate back to the same path without
 * remounting the header, leaving the account chip up after the session was
 * already gone. The form announces the sign-out before submitting; the public
 * account provider listens and drops to its signed-out controls immediately.
 */
export function SignOutForm({
  label = "Sign out",
  pendingLabel = "Signing out…",
  iconOnlyOnMobile = false,
  formClassName,
  variant = "outline",
  size = "sm",
  className,
}: SignOutFormProps) {
  return (
    <form
      action={signOutAction}
      className={formClassName}
      onSubmit={() => {
        // The action runs after this event. The optimistic change is correct:
        // a sign-out clears the local cookie on the server either way.
        window.dispatchEvent(new Event(ACCOUNT_SIGNED_OUT_EVENT));
      }}
    >
      <SignOutButton
        label={label}
        pendingLabel={pendingLabel}
        iconOnlyOnMobile={iconOnlyOnMobile}
        variant={variant}
        size={size}
        className={className}
      />
    </form>
  );
}

function SignOutButton({
  label,
  pendingLabel,
  iconOnlyOnMobile,
  variant,
  size,
  className,
}: Required<Pick<SignOutFormProps, "iconOnlyOnMobile" | "label" | "pendingLabel">> &
  Pick<SignOutFormProps, "variant" | "size" | "className">) {
  const { pending } = useFormStatus();
  const text = pending ? pendingLabel : label;

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disableAutoPending
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
      {iconOnlyOnMobile ? (
        <>
          <span className="hidden sm:inline">{text}</span>
          <span className="sr-only sm:hidden">{text}</span>
        </>
      ) : (
        <span>{text}</span>
      )}
    </Button>
  );
}
