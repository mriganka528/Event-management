import { GateShell, GateNote, gateMetadata, renderGate } from "@/components/auth/gate";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = gateMetadata("pending");

/** A signed-in account that a super admin has not approved yet. */
export default async function AccessPendingPage() {
  const { user } = await renderGate({ allowed: (state) => (state === "PENDING_APPROVAL" ? "gate" : null) });

  const latest = await prisma.adminAccessRequest.findFirst({
    where: { email: user.email },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, requestedRole: true, status: true },
  });

  return (
    <GateShell
      tone="pending"
      heading="Your request has not been approved yet."
      message="You are signed in, but a super admin has not accepted your request for this system yet. You cannot continue into the workspace until that decision is made."
      bullets={[
        "Your sign-in was successful. This is an authorization decision, not a login failure.",
        "Every request is reviewed by a super admin before any access is granted.",
        "You will be able to continue as soon as you are approved.",
      ]}
    >
      <dl className="mt-6 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card-elevated)] p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Decision state</dt>
          <dd className="mt-1 font-semibold text-[var(--foreground)]">Pending super admin review</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Requested role</dt>
          <dd className="mt-1 font-semibold text-[var(--foreground)]">{latest ? latest.requestedRole.replaceAll("_", " ").toLowerCase() : "Customer workspace"}</dd>
        </div>
        {latest ? (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Submitted</dt>
            <dd className="mt-1 font-semibold text-[var(--foreground)]">
              {latest.createdAt.toISOString().slice(0, 10)} · {latest.status.toLowerCase()}
            </dd>
          </div>
        ) : null}
      </dl>
      <GateNote>
        Approval is applied immediately. Reload this page or sign in again once a super admin has approved your account.
      </GateNote>
    </GateShell>
  );
}
