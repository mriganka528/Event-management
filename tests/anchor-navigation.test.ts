import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Anchor navigation on the public site.
 *
 * The header links to `/#categories`, `/#packages` and `/#gallery`. Those links
 * were reported as working "sometimes", which is the signature of a scroll that
 * races the page rather than a missing link:
 *
 *  - The router scrolls once, after the route commits. When the home page is
 *    still rendering there is no element to scroll to, the attempt is dropped,
 *    and the visitor lands at the top of a long page. Cached page: works. Slow
 *    page: silently does nothing.
 *  - `html` sets `scroll-behavior: smooth`, so the scroll animates while fonts
 *    and carousels are still settling above the target, parking it at a stale
 *    offset.
 *
 * `AnchorScroll` re-checks until the target exists and then holds its position.
 * Checked against the source: a scroll component that renders perfectly can
 * still scroll to the wrong place, or over the visitor.
 */
const source = (path: string) => readFileSync(path, "utf8");

const rootLayout = source("app/layout.tsx");
const anchorScroll = source("components/layout/anchor-scroll.tsx");
const siteHeader = source("components/layout/site-header.tsx");
const homePage = source("app/(root)/page.tsx");

/** Anchor hrefs declared in the shared public navigation. */
const navAnchors = [...siteHeader.matchAll(/href:\s*"\/#([\w-]+)"/g)].map((match) => match[1]);

/** Sections on the landing page, with the classes they carry. */
const homeSections = new Map(
  [...homePage.matchAll(/<section id="([\w-]+)" className="([^"]*)"/g)].map((match) => [match[1], match[2]]),
);

test("the public navigation actually links to anchors the home page has", () => {
  assert.ok(navAnchors.length > 0, "no anchor links found in PUBLIC_NAV, so this scan is broken");
  for (const id of navAnchors) {
    assert.ok(homeSections.has(id), `the navigation links to /#${id}, which no section on the home page provides`);
  }
});

test("every anchored section clears the sticky header", () => {
  // The public header is `sticky top-3/4`, so an anchored section without a
  // scroll margin is scrolled to underneath it — which reads as the link doing
  // nothing, because the heading that proves it worked is hidden behind it.
  //
  // `/#contact` was missing its margin while the other four sections had one, so
  // it covered exactly the case where a visitor scrolls to a section and cannot
  // see that they got there.
  assert.ok(homeSections.size > 0, "no anchored sections found, so this scan is broken");
  for (const [id, className] of homeSections) {
    assert.match(
      className,
      /scroll-mt-/,
      `#${id} has no scroll margin, so the sticky header covers the heading it scrolled to`,
    );
  }
  // Every anchor the header offers, specifically. A section nobody links to is
  // still an anchor in the document, but this is the set that has to work.
  for (const id of navAnchors) {
    assert.match(homeSections.get(id) ?? "", /scroll-mt-/, `/#${id} is reachable from the navigation but lands under the header`);
  }
});

test("the anchor handler is mounted at the root, not on the landing page", () => {
  // The failing navigation is a *client-side transition into* `/`, so a handler
  // living on the home page mounts after the scroll has already been lost.
  assert.match(rootLayout, /<AnchorScroll\s*\/>/, "the root layout must mount AnchorScroll");
  assert.doesNotMatch(homePage, /<AnchorScroll/, "it belongs at the root, not on the page it scrolls within");
});

test("it keeps looking for a target that has not rendered yet", () => {
  // A single scroll after mount is the bug. The target has to be polled for,
  // because on a slow render it does not exist on the first attempt.
  assert.match(anchorScroll, /window\.setInterval\(settle, LOOKING_MS\)/, "the target is looked for only once");
  assert.match(anchorScroll, /const target = targetFromHash\(window\.location\.hash\)/);
  // …and a missing target is explicitly not treated as a failure, so the loop
  // keeps going rather than giving up on the first miss.
  assert.match(
    anchorScroll,
    /if \(!target\) \{[\s\S]*?if \(!window\.location\.hash\) stop\(\);[\s\S]*?return;/,
    "a target that has not rendered yet must not end the search",
  );

  // The retry loop only stops on the counter if the counter is actually *used*.
  // An earlier version computed `attempts` and declared a maximum but never
  // compared against it, so the loop ran forever on a hash that matched no
  // element — a permanent 120ms poll for the rest of the session.
  const bounds = anchorScroll.match(/MAX_LOOKING_ATTEMPTS/g) ?? [];
  assert.ok(
    bounds.length >= 2,
    "MAX_LOOKING_ATTEMPTS is only declared, never compared, so the poll loop has no bound",
  );
  assert.match(
    anchorScroll,
    /attempts\s*>=\s*MAX_LOOKING_ATTEMPTS|attempts\s*>\s*MAX_LOOKING_ATTEMPTS|MAX_LOOKING_ATTEMPTS\s*[<>=]/,
    "the attempt count must gate the loop",
  );
});

test("it scrolls instantly rather than animating", () => {
  // The animation is the mechanism that parks the scroll at a stale offset while
  // the content above settles.
  assert.match(anchorScroll, /behavior: "instant"/);
  assert.doesNotMatch(anchorScroll, /behavior: "smooth"/, "a smooth scroll is what strands the position mid-animation");
});

test("the poll loop is genuinely bounded and fully torn down", () => {
  // An interval that outlives its effect keeps firing for the life of the page.
  // Every exit path has to go through one `stop`, and cleanup has to clear both
  // the interval and the deadline timer.
  assert.match(anchorScroll, /const stop = \(\) => \{[\s\S]*?clearInterval\(interval\);[\s\S]*?clearTimeout\(deadline\);[\s\S]*?\};/);
  assert.match(anchorScroll, /deadline = window\.setTimeout\(stop, MAX_LOOKING_MS\)/, "a hash matching nothing needs a deadline");

  // Every clearInterval must be the paired one, so nothing clears the wrong
  // handle and leaves a timer running.
  const clearCalls = [...anchorScroll.matchAll(/window\.clearInterval\((\w+)\)/g)].map((match) => match[1]);
  assert.ok(clearCalls.length > 0, "no clearInterval found, so this scan is broken");
  for (const handle of clearCalls) {
    assert.equal(handle, "interval", `clearInterval(${handle}) is not the interval this effect created`);
  }
});

test("it holds the position once the page has settled", () => {
  // After landing, later content settling above the target would move it again.
  // Re-asserting unconditionally would fight the visitor, so a correction only
  // happens when the target has actually drifted.
  assert.match(anchorScroll, /let restingAt: number \| null = null;/);
  assert.match(anchorScroll, /restingAt = target\.getBoundingClientRect\(\)\.top;/);
  assert.match(anchorScroll, /Math\.abs\(top - restingAt\) <= DRIFT_TOLERANCE_PX/);
  assert.match(anchorScroll, /DRIFT_TOLERANCE_PX = \d+/, "the drift check needs a tolerance");

  // The reading must happen after the scroll, or it records the pre-scroll
  // position and every later check looks like drift.
  const scrollAt = anchorScroll.indexOf("scrollIntoView(");
  const recordAt = anchorScroll.indexOf("restingAt = target.getBoundingClientRect().top;");
  assert.ok(scrollAt > -1 && recordAt > scrollAt, "the resting position is recorded before the scroll, not after it");
});

test("it never scrolls against somebody who is reading", () => {
  // A late correction landing while the visitor has scrolled is worse than the
  // original bug: it moves the page without being asked.
  assert.match(anchorScroll, /if \(userMoved\) \{[\s\S]*?stop\(\);[\s\S]*?return;/);
  for (const event of ["wheel", "touchmove", "keydown"]) {
    assert.match(
      anchorScroll,
      new RegExp(`addEventListener\\("${event}", markMoved`),
      `a ${event} must count as the visitor taking over`,
    );
    assert.match(anchorScroll, new RegExp(`removeEventListener\\("${event}", markMoved`), `${event} listener leaked`);
  }
});

test("following a second anchor from the same page still works", () => {
  // The effect is keyed on the pathname, so two anchor links in a row on `/`
  // would never re-run without this.
  assert.match(anchorScroll, /\}, \[pathname\]\);/);
  assert.match(anchorScroll, /addEventListener\("hashchange", onHashChange\)/);
  assert.match(anchorScroll, /removeEventListener\("hashchange", onHashChange\)/);
});

test("both navigation renderers use the shared anchor list", () => {
  // The mobile menu has its own rendering of the same items. A gallery link that
  // works on a laptop and not on a phone is the same bug on one screen size.
  const menu = source("components/layout/public-header-menu.tsx");
  assert.match(menu, /nav\.map\(\(item\) =>/);
  assert.match(menu, /href=\{item\.href\}/);
  assert.doesNotMatch(
    menu,
    /href="\/#[a-z]+"/,
    "the menu hard-codes an anchor instead of using the shared list, so the two can disagree",
  );
});