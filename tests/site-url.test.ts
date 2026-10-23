import assert from "node:assert/strict";
import test from "node:test";

import { getSiteUrl } from "@/lib/site";

/**
 * The canonical origin comes from the deployment environment. A developer
 * running this locally has no production URL in their environment, so the
 * default has to be the local dev server rather than a deployment domain.
 */

function withSiteUrl(value: string | undefined, run: () => void) {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = value;

  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
}

test("uses the public site URL from the environment", () => {
  withSiteUrl("https://planora-sage-ten.vercel.app", () => {
    assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
  });
});

test("trims whitespace and drops any path from the canonical origin", () => {
  withSiteUrl("  https://planora-sage-ten.vercel.app/some/path/  ", () => {
    assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
  });
});

test("falls back to localhost when the variable is absent", () => {
  withSiteUrl(undefined, () => {
    assert.equal(getSiteUrl().origin, "http://localhost:3000");
  });
});

test("falls back to localhost when the value is not an HTTP origin", () => {
  withSiteUrl("javascript:alert(1)", () => {
    assert.equal(getSiteUrl().origin, "http://localhost:3000");
  });
});
