import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Invitation moved",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The old identity-provider staff-invite link. Activation is now handled by
 * single-use tokens at `/activate`, so this route only forwards anyone holding a
 * legacy link to the new screen.
 */
export default async function LegacyStaffInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token && token.length <= 200) redirect(`/activate?token=${encodeURIComponent(token)}`);
  redirect("/join-the-team");
}
