import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { nextRoute, isAwaitingCode, type AuthActionState } from "@/components/auth/action-state";

/** Recursively lists source files under a path. */
function walk(target: string): string[] {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).flatMap((entry) => walk(join(target, entry)));
}

/**
 * A server action hands the flow over with a `status` plus a `next` route, and
 * the form has to follow it. When it does not, the failure is silent: the form
 * re-renders with no error and no navigation, which reads as "login is broken"
 * rather than "the client ignored a status".
 *
 * That is exactly what happened: `beginSignInAction` answers `verify` when a
 * code is sent, but `activate` when a privileged account has cleared its
 * password and still owes a second factor. The sign-in form watched only for
 * `verify`, so an administrator's first successful password never advanced.
 */

/** The exact shapes `lib/auth-actions.ts` returns. */
const signInSendsCode: AuthActionState = {
  status: "verify",
  message: "We sent a 6-digit code to a****@example.com.",
  next: "/verify-two-factor?channel=email",
};
const signInNeedsSecondFactor: AuthActionState = { status: "activate", next: "/two-factor-setup" };
const signInCompleted: AuthActionState = { status: "done", message: "Signed in.", next: "/admin" };
const signInRejected: AuthActionState = { status: "error", error: "That email and password combination is not correct." };
const signInIdle: AuthActionState = { status: "idle" };
const activationHandsOff: AuthActionState = { status: "activate", message: "Password set.", next: "/two-factor-setup?user=u_1" };
const codeResentNoRedirect: AuthActionState = { status: "verify", message: "A new code is on its way." };
const confirmedDone: AuthActionState = { status: "done", message: "Two-factor authentication is on.", next: "/admin" };
const savedSuccessfully: AuthActionState = { status: "success", message: "Password updated." };

test("every sign-in outcome that hands off is followed", () => {
  assert.equal(nextRoute(signInSendsCode), "/verify-two-factor?channel=email");
  // The regression: a privileged admin without a second factor is answered with
  // `activate`, not `verify`, and must still advance.
  assert.equal(nextRoute(signInNeedsSecondFactor), "/two-factor-setup");
  assert.equal(nextRoute(signInCompleted), "/admin");
});

test("a failure or an idle form stays put", () => {
  assert.equal(nextRoute(signInRejected), null);
  assert.equal(nextRoute(signInIdle), null);
  assert.equal(nextRoute(savedSuccessfully), null);
});

test("a verify status with no destination keeps the code form visible", () => {
  // Resending a code re-answers `verify` without a route. Navigating here would
  // throw the user off the form they are filling in.
  assert.equal(nextRoute(codeResentNoRedirect), null);
  assert.equal(isAwaitingCode(codeResentNoRedirect), true);
});

test("activation and second-factor enrolment both hand off", () => {
  assert.equal(nextRoute(activationHandsOff), "/two-factor-setup?user=u_1");
  assert.equal(nextRoute(confirmedDone), "/admin");
});

test("every navigation decision goes through the shared rule", () => {
  const files = [...walk("components/auth"), ...walk("app")].filter((file) => file.endsWith(".tsx"));

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const at of source.matchAll(/window\.location\.(assign|replace)\(/g)) {
      // Look at what drove this navigation, not the whole file: comparing a
      // status is legitimate for deciding what to *show*, but the decision to
      // leave the screen must come from nextRoute, which covers every hand-off.
      const preceding = source.slice(Math.max(0, (at.index ?? 0) - 300), at.index);
      assert.match(preceding, /nextRoute\(/, `${file} navigates without going through nextRoute()`);
      assert.doesNotMatch(
        preceding,
        /status\s*===\s*"(verify|activate|done)"/,
        `${file} decides to navigate from a single status instead of the shared rule`,
      );
    }
  }
});

test("the sign-in form reacts to the activate status its server action returns", () => {
  // Guards the specific pair: this action returns `activate`, and this form has
  // to honour it.
  const actions = readFileSync("lib/auth-actions.ts", "utf8");
  assert.match(actions, /status:\s*"activate" as const,\s*next:\s*"\/two-factor-setup"/, "the action's activate response has changed");

  const form = readFileSync("components/auth/sign-in-form.tsx", "utf8");
  assert.match(form, /nextRoute\(state\)/, "the sign-in form must follow the shared hand-off rule");
});

test("the activation form follows its hand-off too", () => {
  // It previously had no redirect logic at all, so a successful password set
  // from an invitation left the member on the same screen.
  const form = readFileSync("components/auth/activate-form.tsx", "utf8");
  assert.match(form, /nextRoute\(state\)/, "the activation form must follow the shared hand-off rule");
});