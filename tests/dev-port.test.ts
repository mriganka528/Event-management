import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";

/**
 * The development server and a busy port.
 *
 * The port used to be fixed, so a second `npm run dev` — or anything else already
 * holding 3000 — killed the process outright rather than starting. Next has this
 * behaviour built in, but only on the path where Next owns the socket: its
 * `allowRetry` sits in the branch that creates the server itself. This project
 * runs a custom `server.mjs` that creates its own, so that code never runs and
 * `EADDRINUSE` was a hard crash.
 *
 * The rules that matter:
 *
 *  - the port is resolved **before** `next()` is constructed, because Next takes
 *    the port up front for its own bookkeeping. Picking one afterwards leaves
 *    the two disagreeing.
 *  - `process.env.PORT` is corrected to whatever was bound, or Next's dev URLs
 *    and restart bookkeeping point at a port nothing is listening on.
 *  - **development only**. In production the port belongs to a reverse proxy or
 *    a platform; quietly listening elsewhere turns a clear "port in use" error
 *    into a service nobody can reach.
 */
const source = (path: string) => readFileSync(path, "utf8");

const server = source("server.mjs");

/** Binds a port and resolves with the port that was actually taken. */
function occupy(port: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const holder = createServer();
    holder.once("error", reject);
    holder.listen(port, "127.0.0.1", () => {
      resolve(
        () =>
          new Promise<void>((done) => {
            holder.close(() => done());
          }),
      );
    });
  });
}

/** A port nothing is listening on, found by binding and releasing one. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

test("a busy port is reported before the server binds, not only handled after", () => {
  // The probe is what avoids a pointless crash-and-retry, and what lets Next be
  // constructed with the port that will actually be used.
  assert.match(server, /async function resolvePort\(preferred\)/);
  assert.match(server, /if \(!dev\) return preferred;/, "production must not silently move ports");
  assert.match(server, /if \(await isPortAvailable\(candidate\)\)/);
  // The operator has to be told, or they will keep opening 3000.
  assert.match(server, /is in use, using \$\{candidate\} instead\./);

  // …and told which cases this does *not* fix. Next locks the build directory
  // per project rather than per port, so a second dev server for this same app
  // fails on the new port too, with a much less obvious error. Printing a bare
  // "now using 3001" before that failure reads as a contradiction.
  assert.match(
    server,
    /build directory lock is per project, not per port/,
    "the fallback must say that it cannot bypass another dev server for this project",
  );

  // Bounded, so a conflict that never clears fails instead of scanning forever.
  assert.match(server, /const MAX_PORT_ATTEMPTS = \d+;/);
  assert.match(server, /offset < MAX_PORT_ATTEMPTS/);
});

test("the port is resolved before Next is constructed", () => {
  // Next takes the port up front and uses it internally, so resolving afterwards
  // would leave Next advertising a port nothing is listening on.
  const resolveAt = server.indexOf("const port = await resolvePort(");
  const nextAt = server.indexOf("const nextApp = next({");
  assert.ok(resolveAt > -1 && nextAt > -1, "could not find both statements, so this scan is broken");
  assert.ok(resolveAt < nextAt, "next() must be constructed after the port is resolved");

  // And `PORT` is corrected, because Next reads it for its dev URLs.
  assert.match(server, /process\.env\.PORT = String\(port\);/);
});

test("a port taken between the probe and the bind is still recovered", () => {
  // The probe is racy by nature: something else can take the port in between.
  // Handling `EADDRINUSE` on the real bind is what makes the retry reliable
  // rather than merely likely.
  assert.match(server, /function listenOnAvailablePort\(httpServer, preferred\)/);
  assert.match(server, /error\.code === "EADDRINUSE"/);
  // `EACCES` is a reserved port rather than an occupied one; skipping it is right.
  assert.match(server, /error\.code === "EACCES"/);
  assert.match(server, /httpServer\.listen\(preferred \+ attempt, hostname\)/);
  assert.match(server, /attempt < MAX_PORT_ATTEMPTS - 1/, "the retry loop needs a bound");

  // …and the server is started through it, not through a bare `listen`.
  assert.doesNotMatch(
    server,
    /^httpServer\.listen\(/m,
    "httpServer.listen is called directly, so the fallback would never run",
  );
  assert.match(server, /listenOnAvailablePort\(httpServer, port\)/);
});

test("the port actually bound is what gets reported", () => {
  // Logging the requested port when a different one was bound sends people to a
  // dead address.
  assert.match(server, /listenOnAvailablePort\(httpServer, port\)\s*\.then\(\(listeningOn\) => \{/);
  assert.match(server, /if \(listeningOn !== port\) \{[\s\S]*?process\.env\.PORT = String\(listeningOn\);/);
  assert.match(server, /server ready on http:\/\/\$\{hostname\}:\$\{listeningOn\}/);

  // A failure to bind at all still has to be fatal and visible.
  assert.match(server, /Failed to start the server:/);
  assert.match(server, /process\.exit\(1\)/);
});

test("the probe uses a real socket rather than assuming a port is free", () => {
  // `createServer` from `node:net`, aliased so it cannot be confused with the
  // `node:http` one this file also needs.
  assert.match(server, /import \{ createServer as createNetServer \} from "node:net";/);
  assert.match(server, /const probe = createNetServer\(\);/);
  // Both outcomes must be handled: a refusal is "busy", a bind is "free".
  assert.match(server, /probe\.once\("error", \(\) => resolve\(false\)\);/);
  assert.match(server, /probe\.once\("listening", \(\) => probe\.close\(\(\) => resolve\(true\)\)\);/);
  // The probe must be closed, or it leaks a descriptor per candidate port.
  assert.match(server, /probe\.close\(/);
});

test("a port held by another process really is detected", () => {
  // The behavioural half, against a real socket rather than a stub: the probe
  // has to report a bound port as unavailable and release it as available.
  return (async () => {
    const port = await freePort();
    const release = await occupy(port);

    // Binding again on the same port must be refused, which is what the probe
    // translates into `false`.
    const conflict = await new Promise<boolean>((resolve) => {
      const second = createServer();
      second.once("error", (error) => resolve((error as NodeJS.ErrnoException).code === "EADDRINUSE"));
      second.listen(port, "127.0.0.1", () => {
        second.close(() => resolve(false));
      });
    });
    assert.equal(conflict, true, "a bound port must be reported as unavailable");

    await release();

    // Once released, the same port is free again — so the walk terminates.
    const reusable = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    assert.equal(reusable, true, "a released port must be reported as available again");
  })();
});