import { currentUser } from "@clerk/nextjs/server";
import { federateClerkCustomer } from "@/lib/auth/clerk";
import { issueSession } from "@/lib/auth/sign-in";
import { requestIp } from "@/lib/auth/server";
import { relativeRedirectTo } from "@/lib/http-redirect";
import { customerExchangeRefusal, type ExchangeRefusal } from "@/lib/auth/customer-exchange";
import { rateLimitApi } from "@/lib/security";
import { sendCustomerWelcomeEmail } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * Where the local session cookie is minted for a customer who just finished
 * signing in with Clerk.
 *
 * WHY A ROUTE HANDLER
 * -------------------
 * `/customer/auth/complete` is a Server Component, and a Server Component runs
 * *while Next.js is rendering* — `cookies().set()` there throws "Cookies can
 * only be modified in a Server Action or Route Handler". The session cookie is
 * written here instead, where the response headers are still mutable.
 *
 * WHY IT REDIRECTS RATHER THAN ANSWERING JSON
 * -------------------------------------------
 * The obvious shape — the page fetches this endpoint from a client component,
 * then navigates — costs a full page render, a hydration pass, a POST, a JSON
 * round trip, and a second full document download before the customer reaches
 * their dashboard. Going the other way is two redirects and no client JavaScript
 * at all: `proxy.ts` sends the browser here before any rendering starts, this
 * issues the session and points at the workspace, and the next document is
 * already being fetched. It also means the hand-off works with scripting off.
 *
 * Nothing here trusts the caller. The user id is derived from the Clerk session
 * on *this* request, never read from a field or query string, so the browser
 * cannot ask for somebody else's session. The federated account is necessarily
 * a `CUSTOMER` — `federateClerkCustomer` refuses any staff address — and
 * `issueSession` enforces the per-account device cap.
 */
export async function GET(request: Request) {
  // This endpoint mints a session, so it is limited like one. The provider
  // session is the thing that identifies the caller, and it arrives on a
  // same-site redirect, so the request is a top-level navigation rather than a
  // cross-site one.
  const limited = rateLimitApi(request, "customer-session-exchange", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  // 303 rather than 307: the outcome is a decision, not a method to replay.
  // Relative targets, so the browser resolves them against the URL it just
  // requested whatever host and protocol that was — see `lib/http-redirect.ts`.
  const refuse = (code: ExchangeRefusal) => relativeRedirectTo(customerExchangeRefusal(code), 303);

  const user = await currentUser();
  if (!user) return refuse("NOT_SIGNED_IN");

  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  const ipAddress = await requestIp();

  const federated = await federateClerkCustomer(
    {
      clerkId: user.id,
      email: primary?.emailAddress ?? "",
      firstName: user.firstName ?? user.username ?? "",
      lastName: user.lastName ?? null,
      imageUrl: user.imageUrl ?? null,
    },
    ipAddress,
  );

  // The federation reasons are exactly the refusal codes, which is why the
  // lookup in `lib/auth/customer-exchange.ts` can be exhaustive.
  if (!federated.ok) return refuse(federated.reason);

  const session = await issueSession({
    userId: federated.userId,
    channel: null,
    ipAddress,
    deviceId: null,
  });

  if (!session.ok) {
    // Only the device cap can actually reach here; anything else is a bug rather
    // than a decision, and is reported as such rather than as a refusal.
    return session.code === "DEVICE_LIMIT_REACHED" ? refuse("DEVICE_LIMIT_REACHED") : refuse("ACCOUNT_BLOCKED");
  }

  // Clerk is the credential store and the verified source of the address; the
  // federated row above mirrors it. `firstSignIn` is true both for an account
  // this exchange created and for an existing customer profile that has never
  // signed in, so a returning customer is not greeted again.
  if (federated.firstSignIn && primary?.emailAddress) {
    await sendCustomerWelcomeEmail({
      to: primary.emailAddress,
      firstName: user.firstName ?? user.username ?? "",
    });
  }

  return relativeRedirectTo("/customer/dashboard", 303);
}