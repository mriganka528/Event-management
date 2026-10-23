import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrigin } from "@/lib/origin";

/**
 * Same-origin checks for state-changing requests.
 *
 * The browser sends `Origin: http://localhost:3000`, but a custom Node server
 * binding `0.0.0.0` makes Next build `request.url` as
 * `http://0.0.0.0:3000/...`. Comparing the two literally rejected every upload
 * (and every other POST) with "Cross-origin request denied." even though the
 * request was same-origin. These cases pin down the aliases and the proxy path
 * that have to be accepted, and confirm a genuinely foreign origin is not.
 */

function sameOrigin(url: string, headers: Record<string, string>) {
  return isSameOrigin(new Request(url, { method: "POST", headers }));
}

test("a localhost page may post to a server bound on 0.0.0.0", () => {
  assert.equal(
    sameOrigin("http://0.0.0.0:3000/api/admin/uploads", {
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
    true,
  );
});

test("loopback aliases are interchangeable on the same port", () => {
  assert.equal(
    sameOrigin("http://0.0.0.0:3000/api/admin/uploads", {
      origin: "http://127.0.0.1:3000",
      host: "localhost:3000",
    }),
    true,
  );
});

test("a different loopback port is still a different origin", () => {
  assert.equal(
    sameOrigin("http://0.0.0.0:3000/api/admin/uploads", {
      origin: "http://localhost:4000",
      host: "localhost:3000",
    }),
    false,
  );
});

test("a LAN address that the browser actually used is accepted", () => {
  assert.equal(
    sameOrigin("http://0.0.0.0:3000/api/admin/uploads", {
      origin: "http://192.168.1.20:3000",
      host: "192.168.1.20:3000",
    }),
    true,
  );
});

test("a proxy's forwarded host supplies the public origin", () => {
  assert.equal(
    sameOrigin("http://10.0.0.5:3000/api/admin/uploads", {
      origin: "https://events.example.com",
      host: "10.0.0.5:3000",
      "x-forwarded-host": "events.example.com",
      "x-forwarded-proto": "https",
    }),
    true,
  );
});

test("the configured site origin is accepted", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://events.example.com";
  try {
    assert.equal(
      sameOrigin("http://10.0.0.5:3000/api/admin/uploads", {
        origin: "https://events.example.com",
        host: "10.0.0.5:3000",
      }),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("a foreign origin is rejected", () => {
  assert.equal(
    sameOrigin("http://0.0.0.0:3000/api/admin/uploads", {
      origin: "https://evil.example",
      host: "localhost:3000",
    }),
    false,
  );
});

test("an unparseable origin is rejected", () => {
  assert.equal(
    sameOrigin("http://0.0.0.0:3000/api/admin/uploads", {
      origin: "not a url",
      host: "localhost:3000",
    }),
    false,
  );
});

test("production rejects a request that carries no Origin", () => {
  const previous = process.env.NODE_ENV;
  // `NODE_ENV` is part of the process type; assigning is still how tests switch
  // the branch being exercised, and this file runs in its own process.
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    assert.equal(sameOrigin("http://0.0.0.0:3000/api/admin/uploads", { host: "localhost:3000" }), false);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
});
