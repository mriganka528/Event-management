import Link from "next/link";
import { GateShell, GateNote, gateMetadata, renderGate } from "@/components/auth/gate";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = gateMetadata("denied");

type Reason = "rejected" | "suspended" | "deactivated";

const COPY: Record<Reason, { heading: string; message: string; bullets: readonly string[] }> = {
  rejected: {
    heading: "Your request was not accepted by the admin.",
    message:
      "Your request is not accepted by the admin, so you are not authorized to continue into this system. No booking, payment, or account data is available to you.",
    bullets: [
      "Your account exists, but it carries no access to the workspace.",
      "Ask a super admin to review the decision if you believe it is a mistake.",
      "Signing in again, or with a different email, will not grant access.",
    ],
  },
  suspended: {
    heading: "Your account has been suspended.",
    message:
      "Your access was suspended by a super admin, so you are not authorized to continue. Any active sessions are refused as soon as the suspension is applied.",
    bullets: [
      "This is a deliberate security control, not a password problem.",
      "Contact a super admin to request reactivation.",
      "Data already stored remains on the server and is not exposed while you are suspended.",
    ],
  },
  deactivated: {
    heading: "Your account is deactivated.",
    message:
      "Your account was deactivated by a super admin, so you are not authorized to continue. Your credentials still work, but this application will not grant you access.",
    bullets: [
      "Deactivation is enforced server-side on every request.",
      "Contact a super admin to have the account reactivated.",
    ],
  },
};

/** Rejected, suspended, and deactivated accounts all land here. */
export default async function AccessDeniedPage() {
  const { context } = await renderGate({
    allowed: (state) => (state === "REJECTED" || state === "SUSPENDED" || state === "DEACTIVATED" ? "gate" : null),
  });

  const reason: Reason = context.state === "SUSPENDED" ? "suspended" : context.state === "DEACTIVATED" ? "deactivated" : "rejected";
  const copy = COPY[reason];
  return (
    <GateShell
      tone="denied"
      heading={copy.heading}
      message={copy.message}
      bullets={copy.bullets}
      extraAction={
        reason === "rejected" ? (
          <Link href="/join-the-team">
            <Button>
              Send a new access request
            </Button>
          </Link>
        ) : null
      }
    >
      {context.user?.suspensionReason ? (
        <GateNote>Reason recorded by the administrator: {context.user.suspensionReason}</GateNote>
      ) : null}
    </GateShell>
  );
}
