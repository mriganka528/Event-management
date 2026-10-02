import assert from "node:assert/strict";
import test from "node:test";
import { bookingSchema } from "@/lib/validation";

const base = {
  customerName: "Test Customer",
  customerEmail: "test@example.com",
  customerPhone: "9876543210",
  eventType: "BIRTHDAY",
  eventDate: "2030-01-01",
  location: "Test Venue",
  guestCount: 25,
  services: [{ serviceId: "tent", quantity: 1 }],
};

test("requires a package or a service for a booking", () => {
  assert.throws(() => bookingSchema.parse({ ...base, services: [] }));
  assert.equal(bookingSchema.parse(base).guestCount, 25);
});

test("coerces numeric form values and bounds service counts", () => {
  const result = bookingSchema.parse({ ...base, guestCount: "40", services: [{ serviceId: "tent", quantity: "2" }] });
  assert.equal(result.guestCount, 40);
  assert.equal(result.services[0].quantity, 2);
});
