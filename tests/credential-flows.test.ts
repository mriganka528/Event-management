import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  formValues,
  normaliseCode,
  normaliseEmail,
  toFieldErrors,
  validateEmailChangeForm,
  validateNewPasswordForm,
  validatePasswordChangeForm,
  validateResetCodeForm,
  validateResetRequestForm,
} from "@/lib/credential-forms";
import { isAwaitingCode, nextRoute, type AuthActionState } from "@/components/auth/action-state";

/**
 * Guards for the credential screens: the email change, the password change, and
 * the "forgot password" recovery flow.
 *
 * The behaviour that matters is that the *stage* is driven by the server's answer
 * and by nothing else. The form used to flip to the code screen from the submit
 * button's `onClick`, so any characters at all in the current-password field
 * advanced the UI and announced that a code had been sent to the new address when
 * none had been. Two rules keep that from coming back:
 *
 *  1. `maskedDestination` is present only once a challenge really exists, so its
 *     presence is what decides the code screen is showing.
 *  2. Every credential form validates required fields before the action runs, and
 *     an empty field produces a message that names it.
 */

function walk(target: string): string[] {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).flatMap((entry) => walk(join(target, entry)));
}

const source = (path: string) => readFileSync(path, "utf8");

// ------------------------------------------------------------------- validation

test("an empty required field is reported by name, not as a generic error", () => {
  const emailIssues = validateEmailChangeForm({ newEmail: "", currentPassword: "" });
  assert.equal(emailIssues.some((issue) => issue.field === "newEmail" && /required/i.test(issue.message)), true);
  assert.equal(emailIssues.some((issue) => issue.field === "currentPassword" && /required/i.test(issue.message)), true);

  const passwordIssues = validatePasswordChangeForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  assert.deepEqual(
    passwordIssues.map((issue) => issue.field),
    ["currentPassword", "newPassword", "confirmPassword"],
  );

  const resetIssues = validateResetRequestForm({ email: "" });
  assert.equal(resetIssues[0]?.field, "email");
  assert.match(resetIssues[0]?.message ?? "", /required/i);
});

test("whitespace does not satisfy a required field", () => {
  const issues = validateEmailChangeForm({ newEmail: "   ", currentPassword: "\t" });
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => /required/i.test(issue.message)));
});

test("a malformed address is rejected and a well-formed one is not", () => {
  for (const bad of ["nope", "no-at-sign.example.com", "two@@example.com", "trailing@dot."]) {
    const issues = validateResetRequestForm({ email: bad });
    assert.equal(issues.length, 1, `${bad} should be rejected`);
    assert.equal(issues[0]?.field, "email");
  }
  assert.deepEqual(validateResetRequestForm({ email: " Admin@Example.COM " }), []);
});

test("mismatched passwords are caught before anything is sent", () => {
  const issues = validatePasswordChangeForm({ currentPassword: "old-password-1", newPassword: "abcdefghijkl1", confirmPassword: "abcdefghijkl2" });
  assert.deepEqual(issues, [{ field: "confirmPassword", message: "Passwords do not match." }]);
  assert.deepEqual(validatePasswordChangeForm({ currentPassword: "old-password-1", newPassword: "abcdefghijkl1", confirmPassword: "abcdefghijkl1" }), []);
  assert.deepEqual(validateNewPasswordForm({ newPassword: "abcdefghijkl1", confirmPassword: "abcdefghijkl1" }), []);
});

test("the code must be six digits, and pasted formatting is tolerated", () => {
  assert.equal(normaliseCode(" 123 456 "), "123456");
  assert.equal(normaliseCode("123-456"), "123456");
  assert.equal(normaliseCode("12a3b4c56"), "123456");

  assert.equal(validateResetCodeForm({ email: "a@b.co", code: "123" }).length, 1);
  assert.deepEqual(validateResetCodeForm({ email: "a@b.co", code: "123 456" }), []);
  // An empty code is the one case the form itself catches before the action runs.
  assert.equal(validateEmailChangeForm({ newEmail: "a@b.co", currentPassword: "x" }).length, 0);
  assert.equal(validateEmailChangeForm({ newEmail: "a@b.co", currentPassword: "x", code: "12345" }).length, 1);
});

test("the first field issue is the one a toast should announce", () => {
  const issues = validatePasswordChangeForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  // Ordering matters: the toast shows `issues[0]`, so it must be the field the
  // user is looking at first rather than an arbitrary one.
  assert.equal(issues[0]?.field, "currentPassword");
  assert.deepEqual(toFieldErrors(issues), {
    currentPassword: issues[0]?.message,
    newPassword: issues[1]?.message,
    confirmPassword: issues[2]?.message,
  });
});

test("form values keep the first string for every field", () => {
  const data = new FormData();
  data.append("email", "first@example.com");
  data.append("email", "second@example.com");
  data.append("blank", "");
  data.append("file", new Blob(["x"]));
  const values = formValues(data);
  assert.equal(values.email, "first@example.com");
  assert.equal(values.blank, "");
  assert.equal(values.file, undefined);
  assert.equal(normaliseEmail("  MiXeD@Example.com "), "mixed@example.com");
});

// ----------------------------------------------------------------- stage rules

test("a code screen is only possible once a challenge really exists", () => {
  const codeSentButRejected: AuthActionState = { status: "verify", maskedDestination: "a****@example.com", message: "We sent a 6-digit code." };
  const wrongPassword: AuthActionState = { status: "error", error: "That current password is not correct." };
  const changed: AuthActionState = { status: "success", message: "Your email address is now a****@example.com." };

  // The rule the credentials form encodes as `codeWasSent`.
  const codeWasSent = (state: AuthActionState) => state.status !== "success" && Boolean(state.maskedDestination);
  assert.equal(codeWasSent(codeSentButRejected), true);
  assert.equal(codeWasSent(wrongPassword), false, "a rejected current password must not reveal a code screen");
  assert.equal(codeWasSent(changed), false);
  assert.equal(isAwaitingCode(wrongPassword), false);
  assert.equal(nextRoute(changed), null);
});

test("the reset flow hands off to the password screen with a route", () => {
  const accepted: AuthActionState = { status: "done", message: "Code accepted.", next: "/reset-password" };
  assert.equal(nextRoute(accepted), "/reset-password");

  const finished: AuthActionState = { status: "done", message: "Your password has been changed.", next: "/sign-in" };
  assert.equal(nextRoute(finished), "/sign-in");
});

// ------------------------------------------------------------- source guards

test("no credential form advances on a click instead of on the server's answer", () => {
  for (const file of walk("components/auth")) {
    if (!file.endsWith(".tsx")) continue;
    const text = source(file);
    // The regression: `onClick={() => setCodeSent(true)}` on the submit button
    // showed the code screen whatever the server had (or had not) done.
    assert.doesNotMatch(
      text,
      /onClick=\{\s*\(\)\s*=>\s*set[A-Za-z]*(CodeSent|AwaitingCode|Step)\(true\)/,
      `${file} must not open the code screen from a click handler`,
    );
  }
});

test("every password field in the auth screens has a reveal control", () => {
  const passwordInputs: string[] = [];
  for (const file of walk("components/auth")) {
    if (!file.endsWith(".tsx")) continue;
    const text = source(file);
    for (const match of text.matchAll(/<Input\b[^>]*type="password"[^>]*\/?>/g)) passwordInputs.push(`${file}: ${match[0]}`);
  }
  // The shared control owns the toggle, so a raw `type="password"` on `Input`
  // means a field the user cannot check before submitting.
  assert.deepEqual(passwordInputs, [], `use PasswordInput instead of a bare password Input:\n  ${passwordInputs.join("\n  ")}`);

  assert.match(source("components/ui/password-input.tsx"), /EyeOff/, "the reveal control must be able to hide again");
});

test("every auth screen follows the shared hand-off rule before navigating", () => {
  for (const file of walk("components/auth")) {
    if (!file.endsWith(".tsx")) continue;
    const text = source(file);
    for (const at of text.matchAll(/window\.location\.(assign|replace)\(/g)) {
      const preceding = text.slice(Math.max(0, (at.index ?? 0) - 300), at.index);
      assert.match(preceding, /nextRoute\(/, `${file} navigates without going through nextRoute()`);
    }
  }
});

test("a rejected step does not wipe what the user already typed", () => {
  // React resets an uncontrolled form once an action settles, exactly as a native
  // submission does. In a two-step credential flow that silently throws away the
  // new address and the new password every time a step is rejected, so fixing one
  // wrong character meant retyping everything — and step two could not be
  // completed at all, because it submits the same fields again.
  const fields = jsxTags(source("components/auth/credentials-form.tsx"), ["Input", "PasswordInput"])
    .concat(jsxTags(source("components/auth/reset-password-form.tsx"), ["Input", "PasswordInput"]))
    .concat(jsxTags(source("components/auth/activate-form.tsx"), ["Input", "PasswordInput"]));

  assert.ok(fields.length >= 8, `expected the credential forms to expose their fields, found ${fields.length}`);
  for (const tag of fields) {
    // A hidden field is a constant, not user input, so it is exempt.
    if (tag.includes('type="hidden"')) continue;
    const name = /\bname="([^"]+)"/.exec(tag)?.[1];
    assert.ok(name, `an input has no name: ${tag.slice(0, 60)}`);
    assert.match(tag, /\bvalue=\{/, `the "${name}" field is uncontrolled, so a rejected step clears it`);
    assert.match(tag, /\bonChange=/, `the "${name}" field is read-only, so it can never be filled in`);
  }
});

/** Opening tags of the given JSX element names, with `{...}` contents skipped. */
function jsxTags(text: string, names: string[]): string[] {
  const tags: string[] = [];
  for (const name of names) {
    for (const match of text.matchAll(new RegExp(`<${name}\\b`, "g"))) {
      let depth = 0;
      let index = match.index ?? 0;
      for (; index < text.length; index += 1) {
        const character = text[index];
        // Braces are what let an inline `onChange={(e) => ...}` contain the `>`
        // that would otherwise end the tag early.
        if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
        else if (character === ">" && depth === 0) break;
      }
      tags.push(text.slice(match.index ?? 0, index + 1));
    }
  }
  return tags;
}

test("the recovery routes are registered as public, cache-proof screens", () => {
  const proxy = source("proxy.ts");
  for (const route of ["/forgot-password", "/reset-password"]) {
    assert.match(proxy, new RegExp(`"${route.replace("/", "\\/")}"`), `${route} must be listed in PUBLIC_AUTH_PATHS`);
  }
});

test("the recovery actions never leak whether an address is registered", () => {
  const actions = source("lib/auth-actions.ts");
  const start = actions.indexOf("export async function requestPasswordResetAction");
  assert.ok(start > 0, "requestPasswordResetAction is missing");
  const body = actions.slice(start, actions.indexOf("export async function verifyPasswordResetCodeAction"));

  // One shared answer object, returned by the unknown-address path and by the
  // known-address path alike, so the two are identical to the caller.
  assert.match(body, /const answer = \{ status: "verify"/);
  assert.match(body, /if \(!account\) return answer;/);
  assert.match(body, /PASSWORD_RESET_REQUESTED[\s\S]{0,300}\}\);\s*\n\s*return answer;/);
  assert.doesNotMatch(body, /no account|unknown email|does not exist/i, "the answer must not disclose account existence");

  // A refused or undelivered code must never be reported as sent. This was the
  // original defect: a throttled or undeliverable code still answered "a 6-digit
  // code is on its way", so the user waited for mail that was never sent.
  const issued = body.indexOf("if (!issued.ok)");
  assert.ok(issued > 0, "the issuance result must be checked");
  // Comments explain the rule, so only the code is asserted on.
  const failure = body
    .slice(issued, issued + 900)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.match(failure, /status: "error"/);
  assert.match(failure, /console\.error/);
  assert.doesNotMatch(failure, /on its way/);
});

test("the credential actions are two-step, and the code step is session-bound", () => {
  const actions = source("lib/auth-actions.ts");
  assert.match(actions, /boundSessionId: sessionId/, "a credential code must be bound to the session that asked for it");
  // The email change must read the destination from the stored challenge rather
  // than trusting a field the form controls.
  assert.match(actions, /const pending = await pendingChallenge\(user\.id, sessionId, OtpPurpose\.EMAIL_VERIFY\)/);
  assert.doesNotMatch(actions, /email: parsed\.data\.newEmail\s*,\s*emailVerifiedAt/, "the confirmed address must come from the challenge, not the form");
});

test("the reset steps navigate by redirect, not by a client effect", () => {
  // Both reset steps destroy their own screen as a side effect: verifying the code
  // un-renders the address form, and saving the password drops every session and
  // un-renders the reset form. A component that is told to navigate after its own
  // action has already unmounted it never gets the chance, so the user is left
  // looking at a form with nothing to act on. The action redirects instead.
  const actions = source("lib/auth-actions.ts");
  const verify = actions.slice(actions.indexOf("export async function verifyPasswordResetCodeAction"), actions.indexOf("export async function completePasswordResetAction"));
  assert.match(verify, /redirect\("\/reset-password"\)/, "a verified code must redirect from the action");
  assert.doesNotMatch(verify, /next: "\/reset-password"/, "it must not rely on the form following a status");

  const complete = actions.slice(actions.indexOf("export async function completePasswordResetAction"));
  assert.match(complete, /redirect\("\/sign-in\?password=reset"\)/, "a completed reset must redirect from the action");
  assert.match(complete, /clearSessionCookies\(\)/, "the reset must drop this session too");

  // The confirmation therefore has to survive a full page load.
  assert.match(source("app/(auth)/sign-in/page.tsx"), /query\.password === "reset"/);
  for (const file of ["components/auth/forgot-password-form.tsx", "components/auth/reset-password-form.tsx"]) {
    assert.doesNotMatch(source(file), /window\.location\./, `${file} must not navigate the browser itself`);
  }
});

test("a reset can only be completed from a must-set-password session", () => {
  const actions = source("lib/auth-actions.ts");
  const start = actions.indexOf("export async function completePasswordResetAction");
  assert.ok(start > 0, "completePasswordResetAction is missing");
  const body = actions
    .slice(start)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.match(body, /getAuthContext\(\)/);
  assert.match(body, /if \(!context\.user\.mustSetPassword\)/, "the reset must be gated on the must-set-password state");
  // `requireUserForAction` throws for exactly that state, so it cannot be the guard.
  assert.doesNotMatch(body, /requireUserForAction/);
});

test("no new password is parked server-side between the two steps", () => {
  const actions = source("lib/auth-actions.ts");
  const start = actions.indexOf("export async function changePasswordAction");
  assert.ok(start > 0);
  const body = actions.slice(start, actions.indexOf("// --------------------------------------------------------- forgot / reset password"));
  // Nothing may be written to the database or a cookie that could carry the
  // candidate password; it is submitted again on the code step instead.
  assert.doesNotMatch(body, /passwordHash:\s*hashPassword\(parsed\.data\.newPassword\)[\s\S]{0,400}issueOtp/, "the new password must not be stored before the code is verified");
});

test("a code that could not be sent is never reported as a wrong password", () => {
  // The regression: `beginSignIn` mapped every `issueOtp` failure onto
  // INVALID_CREDENTIALS, so a *correct* password plus a throttled or undeliverable
  // code told the user their password was wrong — and sent them off to reset a
  // password that was never the problem.
  const signIn = source("lib/auth/sign-in.ts");
  const branchStart = signIn.indexOf("if (!issued.ok)");
  const branch = signIn.slice(branchStart, signIn.indexOf("await prisma.user.update", branchStart));

  assert.ok(branchStart > 0, "the issuance result must be inspected");
  assert.doesNotMatch(branch, /INVALID_CREDENTIALS/, "a delivery failure must not be reported as bad credentials");
  assert.match(branch, /CODE_RATE_LIMITED/);
  assert.match(branch, /CODE_NOT_SENT/);
  assert.match(signIn, /case "CODE_RATE_LIMITED":\s*\n\s*return "[^"]*Wait an hour/);
  assert.match(signIn, /case "CODE_NOT_SENT":\s*\n\s*return "[^"]*password was correct/);

  // Every code still has a message, so the switch cannot go quiet for one of them.
  const codes = [...signIn.matchAll(/case "([A-Z_]+)":/g)].map((m) => m[1]);
  assert.equal(codes.length, new Set(codes).size, "an error code is handled twice");
  assert.ok(codes.includes("CODE_NOT_SENT") && codes.includes("CODE_RATE_LIMITED"));
});

test("a rejected code is never reported as a wrong password", () => {
  // The regression, and the one users actually hit: `completeSignIn` returned
  // INVALID_CREDENTIALS for every failure out of `verifyOtp`, so a mistyped code
  // on the OTP screen said the email and password were wrong — when the password
  // had already been accepted in step 1. The user re-typed a password that was
  // right, or went off to reset one that was never the problem.
  const signIn = source("lib/auth/sign-in.ts");
  const start = signIn.indexOf("export async function completeSignIn");
  const end = signIn.indexOf("/** Issues the session cookie", start);
  const body = signIn.slice(start, end);

  const catchBlock = body
    .slice(body.indexOf("} catch (error) {"))
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(catchBlock, /INVALID_CREDENTIALS/, "a rejected code must not be reported as bad credentials");
  assert.match(catchBlock, /otpFailure\(error\)/, "the OTP failure has to be inspected");

  // One code per outcome, so the message can say what to do next rather than
  // saying "not correct" for an expired code and a burned one alike.
  assert.match(signIn, /case "INVALID_CODE":\s*\n\s*return "[^"]*code is not correct/);
  assert.match(signIn, /case "CODE_EXPIRED":\s*\n\s*return "[^"]*expired/);
  assert.match(signIn, /case "CODE_ATTEMPTS_EXCEEDED":\s*\n\s*return "[^"]*incorrect attempts/);
  assert.match(signIn, /case "CODE_SUPERSEDED":\s*\n\s*return "[^"]*no longer valid/);

  // Every OTP outcome has to map somewhere; an unmapped one would silently fall
  // back to the wrong-code wording, which is how this started.
  const mapping = signIn.slice(signIn.indexOf("function otpFailure"), signIn.indexOf("async function recentFailures"));
  for (const code of ["EXPIRED", "TOO_MANY_ATTEMPTS", "NOT_FOUND", "ALREADY_USED"]) {
    assert.match(mapping, new RegExp(`case "${code}":`), `${code} needs its own wording`);
  }
  // The attempts-left countdown is the reason to keep the OTP layer's message.
  assert.match(mapping, /error instanceof OtpError && error\.message/);

  // The step-2 codes must not exist on step 1, where the password really is what
  // is being checked, and the OTP screen must show whatever the action returned.
  assert.match(source("components/auth/two-factor-form.tsx"), /<AuthFeedback state=\{state\} \/>/);
  assert.doesNotMatch(
    source("lib/auth-actions.ts").slice(
      source("lib/auth-actions.ts").indexOf("export async function completeSignInAction"),
      source("lib/auth-actions.ts").indexOf("export async function resendTwoFactorAction"),
    ),
    /INVALID_CREDENTIALS|email and password/,
    "the action must surface the code failure it was given, verbatim",
  );
});