import assert from "node:assert/strict";
import test from "node:test";
import { toFriendlyError } from "@/lib/errors";
import { adminRequestSchema, staffSchema } from "@/lib/validation";

test("turns a raw Zod error into a readable message instead of JSON", () => {
  const result = staffSchema.safeParse({ firstName: "", email: "valid@example.com", staffType: "DECORATOR" });
  assert.equal(result.success, false);
  if (result.success) return;
  const message = toFriendlyError(result.error);
  assert.equal(message, "First name is required.");
  assert.equal(message.includes("{"), false);
  assert.equal(message.includes('"code"'), false);
});

test("recovers a friendly message from a serialized Zod issue list", () => {
  const serialized = JSON.stringify([
    { origin: "string", code: "too_small", minimum: 2, inclusive: true, path: ["firstName"], message: "First name is required." },
  ]);
  assert.equal(toFriendlyError(new Error(serialized)), "First name is required.");
});

test("keeps schema messages and summarizes multiple issues", () => {
  const result = staffSchema.safeParse({ firstName: "A", email: "nope", staffType: "DECORATOR" });
  assert.equal(result.success, false);
  if (result.success) return;
  const message = toFriendlyError(result.error);
  assert.equal(message.includes("{" ), false);
  assert.ok(message.includes("+1 more"));
});

test("generates a readable field message when no custom message is present", () => {
  const zodLike = { issues: [{ code: "too_small", path: ["firstName"], message: "Too small: expected string to have >=2 characters" }] };
  assert.equal(toFriendlyError(zodLike), "First name is required.");
});

test("passes through friendly business errors unchanged", () => {
  assert.equal(toFriendlyError(new Error("That email is already in use.")), "That email is already in use.");
  assert.equal(toFriendlyError(new Error("Prisma error: Unique constraint failed")), "That record already exists.");
  assert.equal(toFriendlyError("Booking cancelled."), "Booking cancelled.");
});

test("staff access requests only allow known roles and require a verified email shape", () => {
  assert.equal(adminRequestSchema.safeParse({ firstName: "Ravi", email: "ravi@example.com", requestedRole: "STAFF" }).success, true);
  assert.equal(adminRequestSchema.safeParse({ firstName: "Ravi", email: "ravi@example.com", requestedRole: "OWNER" }).success, false);
  assert.equal(adminRequestSchema.safeParse({ firstName: "R", email: "ravi@example.com", requestedRole: "STAFF" }).success, false);
});
