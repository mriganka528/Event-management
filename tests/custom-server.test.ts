import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * `server.mjs` runs outside the TypeScript build: it is the custom server, plain
 * JavaScript, so nothing type-checks the Prisma queries in it.
 *
 * That is not a theoretical gap. The socket handshake filtered sessions on
 * `authSessions`, which is the *model* name; the field on `User` is `sessions`.
 * Prisma rejected the unknown key, the surrounding `catch` swallowed it, and
 * every handshake answered "Authentication failed" — so the admin's live badge sat
 * on "Connecting" forever with nothing in the logs and nothing on screen to act
 * on.
 *
 * These checks read the schema rather than trusting either side, so renaming a
 * relation or reintroducing a model name fails here instead of in production.
 */

const schema = readFileSync("prisma/schema.prisma", "utf8");
const server = readFileSync("server.mjs", "utf8");

/** `model Name { ... }` blocks, keyed by model name. */
function models(): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) out.set(match[1], match[2]);
  return out;
}

const declared = models();

/** Field names declared on a model, excluding attributes and relations. */
function fields(model: string): Set<string> {
  const body = declared.get(model);
  if (body === undefined) throw new Error(`schema.prisma has no model ${model}`);
  const out = new Set<string>();
  for (const line of body.split("\n")) {
    const field = /^\s{2}(?:"([^"]+)"|(\w+))\s+\w/.exec(line);
    if (field) out.add(field[1] ?? field[2]);
  }
  return out;
}

/** Model names, which are the trap: `AuthSession` is a model, not a `User` field. */
const modelNames = new Set(declared.keys());

/**
 * Keys written directly in the object literal that starts at `open`.
 *
 * Nested keys are skipped: `where: { sessions: { some: { tokenHash } } }` has one
 * key here, not four, and only that one has to be a field of the model queried.
 */
function directKeys(source: string, open: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{" || character === "[" || character === "(") depth += 1;
    else if (character === "}" || character === "]" || character === ")") {
      depth -= 1;
      if (depth === 0) break;
    } else if (depth === 1 && /[A-Za-z_]/.test(character)) {
      const key = /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?(?=\s*:)/.exec(source.slice(index));
      if (key) {
        keys.push(key[1]);
        index += key[0].length - 1;
      }
    }
  }
  return keys;
}

test("the socket handshake filters on the User relation that actually exists", () => {
  const userFields = fields("User");
  // Names that look like the socket query's keys, taken from the handshake block.
  const handshake = server.slice(server.indexOf("io.use("), server.indexOf('io.on("connection"'));

  const whereOpen = handshake.indexOf("where: {") + "where: ".length;
  const queried = directKeys(handshake, whereOpen);
  assert.ok(queried.length >= 3, `expected to read the handshake where clause, found ${queried.length} keys`);
  for (const key of queried) {
    assert.ok(userFields.has(key), `\`${key}\` is not a field on User`);
  }

  // Named explicitly, because this is the exact pair that shipped wrong.
  assert.ok(userFields.has("sessions"), "User must still declare `sessions`");
  assert.ok(!userFields.has("authSessions"), "`authSessions` is the AuthSession model name, not a User field");
  assert.match(handshake, /sessions:\s*\{\s*some:\s*\{\s*tokenHash:\s*sha256\(token\),\s*status:\s*"ACTIVE"/);
});

test("no Prisma query in server.mjs filters on a model name by mistake", () => {
  // `where`/`select` keys that are model names rather than fields are the shape of
  // the bug. Comparing against every model's fields catches any of them, whatever
  // the model and relation involved.
  const everyField = new Set<string>();
  for (const body of declared.values()) {
    for (const line of body.split("\n")) {
      const field = /^\s{2}(?:"([^"]+)"|(\w+))\s+\w/.exec(line);
      if (field) everyField.add(field[1] ?? field[2]);
    }
  }

  const problems: string[] = [];
  for (const [, key] of server.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*):\s*(?:\{|\[|"|\d|true|false|null)/gm)) {
    if (modelNames.has(key) && !everyField.has(key)) problems.push(key);
  }
  assert.deepEqual(problems, [], `these look like model names used as query keys:\n  ${[...new Set(problems)].join("\n  ")}`);
});

test("a rejected socket handshake is logged, not swallowed", () => {
  const catchBlock = server.slice(server.indexOf("if (!user) throw new Error(\"Active account not found\")"));
  assert.match(catchBlock, /catch \(error\)/, "the catch must bind the error");
  assert.match(catchBlock, /console\.error\(/, "a failed handshake must be logged");
  // The Prisma error object is enormous; the message is what identifies it.
  assert.match(catchBlock, /error instanceof Error \? error\.message : error/);
});