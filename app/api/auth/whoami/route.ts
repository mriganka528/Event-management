import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/server";
import { formatRoleLabel } from "@/lib/role-label";
import { workspaceForRole } from "@/lib/access-policy";
import { rateLimitApi } from "@/lib/security";

/**
 * Who the current visitor is, for the public header.
 *
 * The marketing pages are statically cached with a one-minute revalidate window,
 * so they cannot read the session cookie on the server without giving up ISR
 * entirely — which is a large SEO and time-to-first-byte cost for the surface
 * that matters most. The header still has to say whether the visitor is signed
 * in as a customer or as staff, so that one small per-visitor fact is fetched
 * from here after hydration instead.
 *
 * Deliberately minimal: a display name, a role label, and where to go next. No
 * identifiers, no email, no permissions. A signed-out visitor gets a plain
 * `signedIn: false` rather than a 401, because "not signed in" is the expected
 * answer for most traffic and not an error.
 */
export async function GET(request: Request) {
  // Every call resolves a session and touches the database, so it is limited
  // like any other endpoint rather than being treated as free.
  const limited = rateLimitApi(request, "whoami", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const { state, user } = await getAuthContext();
    if (state !== "ACTIVE" || !user || user.mustSetPassword) {
      return NextResponse.json(
        { signedIn: false, name: null, roleLabel: null, workspaceHref: null },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return NextResponse.json(
      {
        signedIn: true,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        roleLabel: formatRoleLabel(user.role),
        workspaceHref: workspaceForRole(user.role),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    // A failure here must never take the page down; the header simply falls
    // back to its signed-out controls.
    return NextResponse.json(
      { signedIn: false, name: null, roleLabel: null, workspaceHref: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}