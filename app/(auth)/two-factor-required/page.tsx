import Link from "next/link";
import { GateShell, gateMetadata, renderGate } from "@/components/auth/gate";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = gateMetadata("mfa");

/**
 * Admins are never allowed to skip the second factor. This screen exists for the
 * case where a session is already established but 2FA enrolment is missing.
 */
export default async function TwoFactorRequiredPage() {
  await renderGate({ allowed: (state) => (state === "MFA_REQUIRED" ? "gate" : null) });

  return (
    <GateShell
      tone="mfa"
      heading="Two-factor authentication is required."
      message="Administrator accounts must protect their sign-in with a one-time code before any admin page can be opened."
      bullets={[
        "Receive codes by email or by SMS, whichever you prefer.",
        "This requirement is enforced for every admin and super admin account.",
        "Your password stays valid; only the second factor is missing.",
      ]}
      extraAction={
        <Link href="/two-factor-setup">
          <Button>Set up two-factor authentication</Button>
        </Link>
      }
    />
  );
}
