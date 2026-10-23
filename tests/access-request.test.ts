import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { adminRequestSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * The public "join the team" request.
 *
 * It is the most attackable action in the app — unauthenticated, writes to the
 * database, and emails every super admin on success — and it also decides what
 * role an applicant is granted. Both halves are pinned here because the failure
 * modes are silent: a missing staff type was defaulted rather than asked for, so
 * a driver was approved as a decorator and nobody was shown it had happened.
 */

const team = readFileSync("lib/auth/team.ts", "utf8");
const authActions = readFileSync("lib/auth-actions.ts", "utf8");
const joinForm = readFileSync("components/auth/join-team-form.tsx", "utf8");
const adminsPage = readFileSync("app/(admin)/admin/admins/page.tsx", "utf8");

test("the signed-in request schema accepts and validates a staff type", () => {
  assert.equal(
    adminRequestSchema.safeParse({ firstName: "Priya", email: "priya@example.com", requestedRole: "STAFF", staffType: "DRIVER" }).success,
    true,
  );
  // An administrator has no staff type, so it stays optional.
  assert.equal(
    adminRequestSchema.safeParse({ firstName: "Priya", email: "priya@example.com", requestedRole: "ADMIN" }).success,
    true,
  );
  // The enum is re-checked rather than trusted, so a hand-crafted request cannot
  // invent a staff role.
  assert.equal(
    adminRequestSchema.safeParse({ firstName: "Priya", email: "priya@example.com", requestedRole: "STAFF", staffType: "SUPER_ADMIN" }).success,
    false,
  );
});

test("a staff request without a staff type is refused, never defaulted", () => {
  assert.match(team, /if \(input\.requestedRole === "STAFF" && !staffType\) \{\s*return \{ ok: false/, "a staff request must state the role it wants");
  // The old code fell back to DECORATOR, which is how a driver ended up filed
  // as a decorator with nobody noticing.
  assert.doesNotMatch(team, /StaffType\.DECORATOR\s*\)\s*:\s*null/, "the submission path must not default the staff type");
});

test("the requested staff type reaches the reviewer", () => {
  // Persisted on submission...
  assert.match(team, /staffType,\s*note:/, "submitAccessRequest must store the staff type on the request row");
  // ...used as the default when approving...
  assert.match(adminsPage, /defaultValue=\{request\.staffType \?\? StaffType\.DECORATOR\}/, "the approve control must start from what was requested");
  // ...and visible as prose, so an empty select cannot be the only signal.
  assert.match(adminsPage, /Wants \{staffTypeLabel\(request\.staffType\)\}/, "the card must show the requested staff role");
  // ...while still being editable.
  assert.match(adminsPage, /name="staffType"[\s\S]{0,400}defaultValue=\{request\.staffType/, "the reviewer must still be able to override it");
});

test("a granted staff type that differs from the request is recorded", () => {
  assert.match(team, /requested \$\{request\.staffType\}/, "an override must be written to the security log");
});

test("one live request per address, and a new one after a decision", () => {
  // The duplicate check has to look at the latest request of any status. Only a
  // request that is still PENDING blocks a new one: an APPROVED request may
  // belong to a staff member who was removed since, and a REJECTED applicant is
  // allowed to try again. A current team member is stopped by the account check
  // above this transaction, not by the old request row.
  assert.match(team, /findFirst\(\{[\s\S]{0,200}where: \{ email \}[\s\S]{0,200}orderBy: \{ createdAt: "desc" \}/, "must read the most recent request for the address");
  assert.match(team, /previous\.status === AdminRequestStatus\.PENDING/, "only a pending request blocks another");
  assert.doesNotMatch(team, /previous\.status !== AdminRequestStatus\.REJECTED/, "an approved request must not block a removed staff member");
});

test("the duplicate check and the insert share one transaction", () => {
  // Read-then-insert across two round trips lets two simultaneous submissions
  // both see "no open request" and both insert.
  assert.match(team, /withSerializableRetry(?:<[^>]+>)?\(async \(tx\) => \{[\s\S]*?findFirst\([\s\S]*?adminAccessRequest\.create\(/, "check and insert must be one serializable transaction");
  // The result is a discriminated union rather than a shape-optional object,
  // so the two branches cannot be read from each other by accident.
  assert.match(team, /outcome: "refused"/, "the refusal must be labelled, not inferred from a missing key");
  assert.match(team, /outcome: "created"/, "so must the insert");
  assert.doesNotMatch(team, /"refused" in attempted/, "an `in` test cannot narrow which properties are present");
});

test("the public request is defended in depth against floods", () => {
  // A honeypot nobody can see, and a fill timer nobody can beat.
  assert.match(joinForm, /name="website"/, "the form needs a honeypot field");
  assert.match(authActions, /if \(str\(formData, "website"\)\)/, "a filled honeypot must be handled");
  assert.match(authActions, /ageMs >= 0 && ageMs < 2000/, "a submission faster than a human can type must be dropped");
  // A clock behind the server makes the difference negative. Treating that as
  // "instant" silently drops every real submission from that browser, which
  // reads as a broken form rather than a rejected bot.
  assert.match(authActions, /ageMs < -60_000/, "a wildly skewed clock must be handled, not read as instant");
  assert.match(joinForm, /name="renderedAt"/, "the form must stamp when it was rendered");
  // Stripping the field is the cheapest way to defeat a fill timer, and
  // `Number("")` is `0` — finite, and decades old. Without an explicit
  // positivity check that reads as "rendered in 1970" and sails through.
  assert.match(
    authActions,
    /stampIsUsable = Number\.isFinite\(renderedAt\) && renderedAt > 0/,
    "a blank or absent timestamp must be refused, not treated as ancient",
  );
  assert.match(authActions, /!stampIsUsable \|\|/, "and that refusal must actually gate the request");

  // Per source, per address, and site-wide: each covers a case the others miss.
  assert.match(authActions, /join-team:ip:\$\{ipAddress\}/, "needs a per-address limit");
  assert.match(authActions, /join-team:day:\$\{ipAddress\}/, "needs a per-address daily limit");
  assert.match(authActions, /join-team:email:\$\{emailKey\}/, "needs a per-email limit");
  assert.match(
    authActions,
    /join-team:global/,
    "needs a site-wide ceiling, because per-IP limits are useless against a botnet and every accepted request costs a real email",
  );
});

test("the render stamp is taken once, on the server, not per render", () => {
  // The form is a client component. Reading the clock in its body produces one
  // number in the server markup and a different one during hydration, which is
  // both a hydration mismatch and a lie about when the form appeared.
  // Scoped to the attribute so the comment explaining this does not trip it.
  assert.doesNotMatch(joinForm, /=\{\s*Date\.now\(\)\s*\}/, "the client must not stamp the form itself");
  assert.match(joinForm, /export function JoinTeamForm\(\{ renderedAt \}: \{ renderedAt: number \}\)/, "the stamp must arrive as a prop");
  assert.match(joinForm, /<input type="hidden" name="renderedAt" defaultValue=\{renderedAt\} \/>/, "and be written into the form");

  // One timestamp per request, shared by every component in the render, so the
  // two branches of the customer page cannot disagree with each other.
  const clock = readFileSync("lib/request-clock.ts", "utf8");
  assert.match(clock, /cache\(\(\) => Date\.now\(\)\)/, "a per-request memo, not a per-render read");
  assert.match(readFileSync("app/(auth)/join-the-team/page.tsx", "utf8"), /requestStartedAt\(\)/, "the public form must use it");
  assert.match(readFileSync("app/(customer)/customer/access/page.tsx", "utf8"), /requestStartedAt\(\)/, "and so must the signed-in one");
});

test("the confirmation shows what was submitted", () => {
  assert.match(authActions, /request: summariseRequest\(result\.request\)/, "the action must hand the submitted request back");
  assert.match(joinForm, /What you sent/, "the confirmation must list the request");
  assert.match(joinForm, /Staff role/, "the confirmation must name the staff role that was requested");
});

test("nothing reports a sent request unless a row exists", () => {
  // The honeypot used to answer with a fabricated success. Autofill heuristics
  // are not a guarantee, so one false positive told an applicant their request
  // had been received when no row had been written and no admin had been told.
  const honeypot = authActions.slice(authActions.indexOf('str(formData, "website")'));
  assert.doesNotMatch(honeypot.slice(0, 400), /status: "success"/, "a dropped submission must not claim it was sent");
  assert.match(authActions, /We could not send that request/, "a dropped submission must say so instead");
});

test("a duplicate refusal shows the request already on file", () => {
  assert.match(team, /previous: toSubmittedRequest\(previous\)/, "the refusal must carry the earlier request");
  assert.match(
    authActions,
    /previousRequest: result\.previous \? summariseRequest\(result\.previous\) : undefined/,
    "the action must pass it to the form",
  );
  assert.match(joinForm, /The request already on file/, "the form must show the existing request");
  assert.match(joinForm, /Nothing was sent/, "a refusal must not read as a success");
});

test("the rate limiter is a fixed window keyed per caller", () => {
  const key = `test:${Math.random()}`;
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, true);
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, true);
  const blocked = checkRateLimit(key, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0, "a refusal must say when to come back");
});
