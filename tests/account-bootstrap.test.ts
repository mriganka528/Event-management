import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ACCOUNT_BOOTSTRAP_KEY, accountBootstrapScript } from "@/lib/account-bootstrap";

/**
 * The public header cannot read the session cookie on the server without giving
 * up static caching on the primary SEO surface, so it resolves the visitor in the
 * browser.
 *
 * It used to do that in a `useEffect`, which cannot start until React has
 * hydrated, which cannot happen until the bundle has downloaded. The header
 * therefore showed its signed-out controls for the whole of that — a few seconds
 * on a marketing page, and a returning customer watching their account chip
 * appear on a page that already looked finished.
 *
 * These assertions pin the fix: the request is issued while the HTML is still
 * being parsed, and the component adopts that in-flight request rather than
 * starting one of its own after the download.
 */

const script = accountBootstrapScript();

test("the root layout inlines the bootstrap in the head, before the body", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /accountBootstrapScript\(\)/, "the bootstrap must be emitted by the root layout");

  // Order matters: a script in `<body>` starts later, and the whole point is to
  // overlap the request with the bundle download.
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  assert.ok(head.includes("accountBootstrapScript()"), "the bootstrap must live in <head>");
});

test("the bootstrap issues the header's own request while the document parses", () => {
  assert.match(script, /fetch\("\/api\/auth\/whoami"/);
  assert.match(script, /credentials: "same-origin"/, "the session cookie must travel with it");
  assert.ok(script.includes(`window.${ACCOUNT_BOOTSTRAP_KEY}`), "the result must be left where the component looks for it");
});

test("the bootstrap skips the workspaces, which never read it", () => {
  // `/admin` and `/staff` render their chrome from the server and would only pay
  // for a request they never consume.
  assert.match(script, /p === "\/admin"/);
  assert.match(script, /p === "\/staff"/);
  // Prefix matching must not catch an unrelated top-level path.
  assert.match(script, /indexOf\("\/admin\/"\) === 0/, "only the /admin subtree is excluded");
});

test("the header adopts the in-flight request instead of starting a second one", () => {
  const provider = readFileSync("components/layout/public-account-status.tsx", "utf8");

  assert.match(provider, /window\[ACCOUNT_BOOTSTRAP_KEY\]/, "the component must look for the bootstrap");
  assert.match(
    provider,
    /delete window\[ACCOUNT_BOOTSTRAP_KEY\]/,
    "the bootstrap must be consumed, or a later page would render a stale answer",
  );
  // The fallback still exists for client-side navigation, where there is no
  // fresh document and therefore no head script to have run.
  assert.match(provider, /fetch\("\/api\/auth\/whoami"/);

  // Adopting must come before the component's own fetch, or the whole point is
  // lost and the visitor waits for the download anyway.
  assert.ok(
    provider.indexOf("window[ACCOUNT_BOOTSTRAP_KEY]") < provider.lastIndexOf('fetch("/api/auth/whoami"'),
    "the in-flight request must be preferred over a new one",
  );
});

test("no public page waits on hydration for its account state", () => {
  // Regression guard for the original symptom: the signed-in chip swapping in
  // seconds after the page looked ready.
  const provider = readFileSync("components/layout/public-account-status.tsx", "utf8");
  const header = readFileSync("components/layout/site-header.tsx", "utf8");

  assert.doesNotMatch(
    provider,
    /useEffect\(\(\) => \{\s*const controller = new AbortController\(\);\s*\n\s*\/\/ Aborted on unmount/,
    "the effect must not start by firing an immediate request of its own",
  );
  assert.match(header, /PublicAccountProvider/, "the header is still wrapped, so the context is shared");
});