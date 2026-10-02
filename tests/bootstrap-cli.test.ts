import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { splitLine } from "../prisma/console-line";

/**
 * The bootstrap prompt is the only way to create the first administrator, and it
 * runs on the operator's own terminal. These cases are the terminators that
 * terminal actually sends.
 */

test("a Windows console Enter is consumed whole", () => {
  // A Windows console delivers "\r\n" for one Enter. Consuming only the "\r"
  // leaves the "\n" in the buffer, and the next prompt reads that stray newline
  // as an empty answer - which is what silently skipped the name field and sent
  // the typed name to the phone question instead.
  const first = splitLine("mrj21012003@gmail.com\r\n");
  assert.deepEqual(first, { line: "mrj21012003@gmail.com", rest: "" });

  const second = splitLine(first!.rest + "Mriganka\r\n");
  assert.equal(second?.line, "Mriganka", "the name must reach the name prompt, not be swallowed");
  assert.equal(second?.rest, "");
});

test("a raw-mode Enter is still read as one line", () => {
  // The password prompts switch the TTY to raw mode, where Enter is a bare "\r".
  assert.deepEqual(splitLine("Correct-Horse-9\r"), { line: "Correct-Horse-9", rest: "" });
});

test("piped stdin still reads one line at a time", () => {
  assert.deepEqual(splitLine("Owner\n"), { line: "Owner", rest: "" });
});

test("answers typed ahead are delivered in order", () => {
  // Several prompts answered in one chunk must not collapse into one answer.
  const first = splitLine("a\r\nb\r\nc\r\n");
  assert.equal(first?.line, "a");
  assert.equal(first?.rest, "b\r\nc\r\n");
  assert.equal(splitLine(first!.rest)?.line, "b");
});

test("an incomplete line is not delivered early", () => {
  // No terminator yet: the prompt must keep waiting rather than return "".
  assert.equal(splitLine("half-typed"), null);
  assert.equal(splitLine(""), null);
});

test("an empty answer is allowed, because every prompt has a default", () => {
  assert.deepEqual(splitLine("\r\n"), { line: "", rest: "" });
});

test("bootstrap reports the missing seed instead of crashing", () => {
  const source = readFileSync("prisma/bootstrap-admin.ts", "utf8");
  // A fresh database is a normal state: the schema exists but the four system
  // roles do not. That must print the next command to run, not a Prisma stack.
  assert.doesNotMatch(source, /findUniqueOrThrow\(\{\s*where:\s*\{\s*key:\s*RoleKey\.SUPER_ADMIN/, "the role lookup must not throw");
  assert.match(source, /npm run db:seed/, "it must name the command that fixes it");
});