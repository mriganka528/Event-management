import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The landing page used to name four event types. Four made the section look
 * like a placeholder and left whole kinds of business — engagements,
 * anniversaries, baby showers, conferences — without a card of their own.
 */
const home = readFileSync("app/(root)/page.tsx", "utf8");

test("the public page names more than the original four events", () => {
  const start = home.indexOf("const categories = [");
  const end = home.indexOf("];", start);
  assert.ok(start > -1 && end > start, "the landing page must keep one category list");

  const names = [...home.slice(start, end).matchAll(/name: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length >= 8, `expected at least 8 categories, found ${names.length}`);

  for (const expected of [
    "Wedding",
    "Engagement",
    "Birthday",
    "Anniversary",
    "Baby Shower",
    "Corporate",
    "Conference",
    "Party",
  ]) {
    assert.ok(names.includes(expected), `${expected} must have a category card`);
  }
});

test("the category grid stays balanced from phone to desktop", () => {
  assert.match(home, /sm:grid-cols-2 lg:grid-cols-4/, "two columns on a tablet, four on a wide screen");
  assert.match(home, /Start a custom request/, "the section needs a route for an occasion that is not listed");
});
