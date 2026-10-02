import assert from "node:assert/strict";
import test from "node:test";
import { eventSchema, inventorySchema, paymentSchema, serviceSchema, staffUpdateSchema } from "@/lib/validation";

test("rejects missing or malformed security-sensitive fields", () => {
  assert.equal(staffUpdateSchema.safeParse({ id: "staff_1" }).success, false);
  assert.equal(inventorySchema.safeParse({ name: "Chairs", category: "CHAIR", totalQuantity: "" }).success, false);
  assert.equal(paymentSchema.safeParse({ bookingId: "booking_1", amount: 100, stage: "ADVANCE", method: "CASH" }).success, false);
  assert.equal(paymentSchema.safeParse({ bookingId: "booking_1", amount: 10.001, stage: "ADVANCE", method: "CASH", idempotencyKey: "payment_123" }).success, false);
  assert.equal(paymentSchema.safeParse({ bookingId: "booking_1", amount: 10.01, stage: "ADVANCE", method: "CASH", idempotencyKey: "payment_123" }).success, true);
  assert.equal(eventSchema.safeParse({ bookingId: "booking_1", title: "Event", startDate: "not-a-date", endDate: "also-not-a-date", location: "Venue" }).success, false);
  assert.equal(serviceSchema.safeParse({ name: "Service", basePrice: 100, unitLabel: "setup", imageUrl: "https://example.com/image.jpg" }).success, false);
});
