import assert from "node:assert/strict";
import test from "node:test";

import { getSiteUrl } from "@/lib/site";

/**
 * The canonical origin comes from the deployment environment. A developer
 * running this locally has no production URL in their environment, so the
 * default has to be the local dev server rather than a deployment domain.
 */

const ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "SITE_URL",
  "APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

type SiteEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function withSiteEnv(env: SiteEnv, run: () => void) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }

  try {
    run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("uses the public site URL from the environment", () => {
  withSiteEnv({ NEXT_PUBLIC_SITE_URL: "https://planora-sage-ten.vercel.app" }, () => {
    assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
  });
});

test("trims whitespace and drops any path from the canonical origin", () => {
  withSiteEnv({ NEXT_PUBLIC_SITE_URL: "  https://planora-sage-ten.vercel.app/some/path/  " }, () => {
    assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
  });
});

test("accepts a bare host copied without a scheme", () => {
  // Vercel environment variables are often just `my-site.vercel.app`. Treating
  // that as invalid silently produced localhost links in production email.
  withSiteEnv({ NEXT_PUBLIC_SITE_URL: "planora-sage-ten.vercel.app" }, () => {
    assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
  });
});

test("uses Vercel's production URL when the public variable is missing", () => {
  withSiteEnv({ VERCEL_PROJECT_PRODUCTION_URL: "planora-sage-ten.vercel.app" }, () => {
    assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
  });
});

test("a localhost value cannot win over the deployment URL in production", () => {
  // A value left over from local development must not put localhost links into
  // production email. If a real deployment origin is available, it wins.
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    withSiteEnv(
      {
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        VERCEL_PROJECT_PRODUCTION_URL: "planora-sage-ten.vercel.app",
      },
      () => {
        assert.equal(getSiteUrl().origin, "https://planora-sage-ten.vercel.app");
      },
    );
  } finally {
    env.NODE_ENV = nodeEnv;
  }
});

test("falls back to localhost when no site URL is configured", () => {
  withSiteEnv({}, () => {
    assert.equal(getSiteUrl().origin, "http://localhost:3000");
  });
});

test("falls back to localhost when the value is not an HTTP origin", () => {
  withSiteEnv({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" }, () => {
    assert.equal(getSiteUrl().origin, "http://localhost:3000");
  });
});
