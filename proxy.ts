import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { isHttps, pendingTwoFactorCookieName, sessionCookieName } from "@/lib/auth/cookie-names";
import { redirectTo } from "@/lib/http-redirect";
import { CUSTOMER_COMPLETE_PATH, EXCHANGE_REFUSAL_PARAM } from "@/lib/auth/customer-exchange";
import { configuredSiteOrigin, isSameOrigin } from "@/lib/origin";

/**
 * Edge middleware.
 *
 * This layer is deliberately thin. Authorisation needs the database, so it is
 * enforced in the layout, page, server action, and API route via
 * `@/lib/auth/server`. Here we only:
 *
 *  - redirect unauthenticated traffic away from protected areas,
 *  - enforce same-origin for state-changing API calls (CSRF),
 *  - redirect non-canonical hosts in production,
 *  - mark private responses `no-store` and `noindex`.
 *
 * The session cookie is opaque, so middleware can cheaply check for its presence
 * without being able to trust it. Anything that depends on *who* the caller is
 * happens server-side.
 */

const ADMIN_PREFIX = "/admin";
const STAFF_PREFIX = "/staff";

/** Paths that always redirect to the canonical origin in production. */
const HOST_EXEMPT = ["/api/payments/razorpay/webhook"];

function isUnder(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The cookie names depend on the protocol, and this layer has to read the same
 * ones the server writes. `isHttps` takes the same two inputs on both sides —
 * `x-forwarded-proto` and the deployment mode — so the two always agree.
 */
function httpsRequest(request: NextRequest): boolean {
  return isHttps(request.headers.get("x-forwarded-proto"), process.env.NODE_ENV === "production");
}

/** Public auth screens. Listed so they are never treated as protected. */
const PUBLIC_AUTH_PATHS = new Set([
  "/sign-in",
  // Where "sign in" lands when the visitor has not said which kind of account
  // they hold. It only links onward, so it is public like the forms it offers.
  "/auth-choice",
  "/join-the-team",
  "/verify-two-factor",
  "/activate",
  "/two-factor-setup",
  "/two-factor-required",
  "/access-pending",
  "/access-denied",
  // Password recovery. `/reset-password` holds a short-lived session issued by a
  // verified reset code, but it is a credential screen, not a workspace, so it
  // must be framed- and cache-proof like the rest of the auth area.
  "/forgot-password",
  "/reset-password",
]);

/**
 * The customer sign-in area hosted by the provider. It is a prefix rather than an
 * exact path because the provider owns several nested routes under it, and none
 * of them may be indexed or framed.
 */
const CUSTOMER_AUTH_PREFIX = "/customer/auth";
const CUSTOMER_SIGN_UP_PATH = `${CUSTOMER_AUTH_PREFIX}/sign-up`;

/** Superseded by {@link CUSTOMER_SIGN_UP_PATH}; kept working as an alias. */
const LEGACY_REGISTER_PATH = "/register";

/**
 * Where the local session is minted for a customer who just came back from the
 * sign-in provider.
 *
 * The hop is made here, at the edge, rather than by the completion page itself.
 * A `redirect()` in a Server Component is delivered through the streamed
 * response as an *HTTP 200* carrying a client-side instruction, because the
 * shell has already been flushed by the time the page's `await` resolves — so
 * the browser still downloads a whole document and still needs JavaScript to
 * reach the dashboard. Answering here costs one empty response and nothing
 * else.
 */
const CUSTOMER_SESSION_EXCHANGE_PATH = "/api/customer/session/exchange";

function isCustomerAuthPath(pathname: string) {
  return isUnder(pathname, CUSTOMER_AUTH_PREFIX);
}

function isProtectedRoute(pathname: string) {
  if (PUBLIC_AUTH_PATHS.has(pathname)) return false;
  // Clerk completes its own redirects; the local session is minted afterwards at
  // /customer/auth/complete, so this area must never be gated on that cookie.
  if (isCustomerAuthPath(pathname)) return false;
  if (isUnder(pathname, ADMIN_PREFIX)) return true;
  if (isUnder(pathname, STAFF_PREFIX)) return true;
  if (isUnder(pathname, "/customer/dashboard")) return true;
  // The booking form itself stays reachable without an account: browsing the
  // catalog and building an estimate is the part that is public. Sending the
  // request needs one, and that is enforced where the booking is written.
  if (pathname.startsWith("/customer/bookings/") && !isUnder(pathname, "/customer/bookings/new")) return true;
  return false;
}

function isPrivatePath(pathname: string) {
  if (isUnder(pathname, ADMIN_PREFIX) || isUnder(pathname, STAFF_PREFIX)) return true;
  if (PUBLIC_AUTH_PATHS.has(pathname)) return true;
  if (isCustomerAuthPath(pathname)) return true;
  if (isUnder(pathname, "/customer/dashboard") || isUnder(pathname, "/customer/track")) return true;
  if (isUnder(pathname, "/customer/access")) return true;
  if (pathname.startsWith("/customer/bookings/") && !isUnder(pathname, "/customer/bookings/new")) return true;
  if (pathname.startsWith("/api/")) return true;
  return false;
}

function applyPrivateHeaders(response: NextResponse, pathname: string) {
  if (isPrivatePath(pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    response.headers.set("Pragma", "no-cache");
  }
  if (isUnder(pathname, "/customer/track")) response.headers.set("Referrer-Policy", "no-referrer");
  // Auth screens must never be framed or cached by a shared proxy.
  if (PUBLIC_AUTH_PATHS.has(pathname) || isCustomerAuthPath(pathname)) {
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  return response;
}

function handleRequest(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const siteOrigin = configuredSiteOrigin();

  // Customer registration moved to the sign-in provider, which verifies the
  // address (and, with Google, the identity) before an account exists. The old
  // path is aliased here rather than with a page so the redirect is a real 308
  // instead of a client-side refresh after a wasted render.
  if (pathname === LEGACY_REGISTER_PATH) {
    return redirectTo(CUSTOMER_SIGN_UP_PATH, request, 308);
  }

  // The happy path of the provider hand-off never renders this page. The
  // exchange endpoint mints the cookie and redirects on to the workspace; the
  // page is only reached when it refuses, carrying a code, and then it is the
  // page's job to explain. Skipping the render is what makes the hand-off two
  // redirects instead of two renders.
  if (pathname === CUSTOMER_COMPLETE_PATH && !searchParams.has(EXCHANGE_REFUSAL_PARAM)) {
    return applyPrivateHeaders(redirectTo(CUSTOMER_SESSION_EXCHANGE_PATH, request), pathname);
  }

  // Canonical host in production, so cookies and absolute links stay consistent.
  if (siteOrigin && request.nextUrl.origin !== siteOrigin && process.env.NODE_ENV === "production" && !["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !HOST_EXEMPT.includes(pathname)) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, siteOrigin));
  }

  // CSRF defence-in-depth for state-changing API calls. The Razorpay webhook is
  // excluded because it is a signed server-to-server call.
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !HOST_EXEMPT.includes(pathname) && !isSameOrigin(request)) {
    return applyPrivateHeaders(NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 }), pathname);
  }

  if (isProtectedRoute(pathname)) {
    // Both names are checked so a cookie written before a protocol change is
    // still recognised rather than bouncing the user to the sign-in form.
    const https = httpsRequest(request);
    const hasSession = Boolean(
      request.cookies.get(sessionCookieName(https))?.value ?? request.cookies.get(sessionCookieName(!https))?.value,
    );
    if (!hasSession) {
      // A half-finished sign-in belongs on the code screen, not the login form.
      if (request.cookies.get(pendingTwoFactorCookieName(https))?.value ?? request.cookies.get(pendingTwoFactorCookieName(!https))?.value) {
        return redirectTo("/verify-two-factor", request);
      }
      // A blocked visitor is sent to the sign-in surface for their own area, so
      // a customer is never bounced to the staff password screen (which they
      // cannot use) and a staff member is never sent to the customer provider.
      const customerArea = pathname.startsWith("/customer/");
      const signIn = customerArea ? `${CUSTOMER_AUTH_PREFIX}/sign-in` : "/sign-in";
      const returnTo = `${pathname}${search}`;
      const target = returnTo && returnTo !== "/"
        ? `${signIn}?returnTo=${encodeURIComponent(returnTo)}`
        : signIn;
      return redirectTo(target, request);
    }
  }

  return applyPrivateHeaders(NextResponse.next(), pathname);
}

/**
 * `clerkMiddleware` authenticates the Clerk session so `auth()` works in server
 * components, then hands the request to this file's own edge rules unchanged.
 *
 * Authorisation is still decided in the layout, page, and server action, because
 * a Clerk session says who someone is and not what they may reach. A staff
 * account is never authorised by Clerk at all: it authenticates first-party and
 * arrives here holding the ordinary local session cookie instead.
 */
export default clerkMiddleware((_auth, request) => handleRequest(request));

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
