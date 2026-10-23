/**
 * Pre-hydration account resolution for the statically cached marketing pages.
 *
 * The landing page is the primary SEO surface and stays statically generated
 * with a short revalidate window, so the public header cannot read the session
 * cookie on the server without giving that up. The one per-visitor fact the
 * header needs — is this visitor signed in, as what, and where do they go next —
 * was therefore fetched from `/api/auth/whoami` in a `useEffect`.
 *
 * A `useEffect` cannot start until React has hydrated, and hydration cannot
 * finish until the JavaScript bundle has downloaded, parsed, and run. The
 * header sat on its signed-out controls for all of that, which on a marketing
 * page is the part of the session a returning customer actually notices: the
 * account chip swapping in seconds after the page looked ready.
 *
 * So the request is started from a tiny inline script in the document head
 * instead, at the moment the browser starts parsing the HTML. It then runs in
 * parallel with the bundle download rather than after it, and the promise it
 * leaves on `window` is exactly what the header component picks up on mount.
 *
 * Emitted as a string because it is a `<script>` in the document and therefore
 * cannot import anything. Nothing request-controlled reaches it: the only
 * literals are the two path prefixes below and the endpoint's own path.
 */

/** Key the inline script publishes its in-flight request under. */
export const ACCOUNT_BOOTSTRAP_KEY = "__EVENT_ACCOUNT__";

/**
 * Broadcast after a sign-out form is submitted.
 *
 * The public header is a client component that lives outside the workspace, so a
 * server-action sign-out does not always remount it: signing out on a cached
 * marketing page can be a client-side navigation back to the same path. Without
 * a local signal the chip would keep claiming the visitor is signed in until a
 * full reload. The provider listens for this and drops straight to the
 * signed-out controls, while the server action clears the session.
 */
export const ACCOUNT_SIGNED_OUT_EVENT = "event:account-signed-out";

export type AccountBootstrapResponse = {
  signedIn?: boolean;
  name?: string | null;
  roleLabel?: string | null;
  workspaceHref?: string | null;
};

declare global {
  interface Window {
    __EVENT_ACCOUNT__?: Promise<AccountBootstrapResponse | null> | undefined;
  }
}

export function accountBootstrapScript(): string {
  return `(() => {
  try {
    var p = location.pathname;
    // The workspaces render their own session-aware chrome straight from the
    // server, so they never consume this and would only pay for the request.
    if (p === "/admin" || p.indexOf("/admin/") === 0 || p === "/staff" || p.indexOf("/staff/") === 0) return;
    // The customer auth screens are standalone and either load Clerk or are
    // left immediately. The header is not mounted there, so asking who the
    // visitor is would only leave a promise for a later page to adopt — one that
    // may describe a session that has changed in the meantime.
    if (p === "/customer/auth" || p.indexOf("/customer/auth/") === 0) return;
    window.${ACCOUNT_BOOTSTRAP_KEY} = fetch("/api/auth/whoami", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  } catch (_) {}
})()`;
}