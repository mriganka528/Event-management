import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("an event is one day long unless the form says otherwise", () => {
  // The day count is only rendered when something in the quote is priced per day,
  // so every request without the field still has to parse — and has to parse as a
  // single day rather than as zero, which would price a per-day service at nothing.
  assert.equal(bookingSchema.parse(base).durationDays, 1);
  assert.equal(bookingSchema.parse({ ...base, durationDays: "3" }).durationDays, 3);
  assert.equal(bookingSchema.safeParse({ ...base, durationDays: "0" }).success, false);
  assert.equal(bookingSchema.safeParse({ ...base, durationDays: "61" }).success, false);
});

test("a booking phone is a 10-digit mobile, with an optional +91 or leading 0", () => {
  for (const phone of ["9876543210", "98765 43210", "+91 98765 43210", "+91-98765-43210", "09876543210"]) {
    assert.equal(bookingSchema.safeParse({ ...base, customerPhone: phone }).success, true, phone);
  }
  for (const phone of ["98765", "987654321", "98765432101", "+1 9876543210", "123456789012345", "not-a-phone"]) {
    assert.equal(bookingSchema.safeParse({ ...base, customerPhone: phone }).success, false, phone);
  }
});

test("a booking address is optional and bounded", () => {
  assert.equal(bookingSchema.parse(base).customerAddress, undefined);
  assert.equal(bookingSchema.parse({ ...base, customerAddress: "12 Market Road, Jaipur" }).customerAddress, "12 Market Road, Jaipur");
  assert.equal(bookingSchema.safeParse({ ...base, customerAddress: "x".repeat(301) }).success, false);
});

test("a signed-in booking writes the submitted phone and address back to the account", () => {
  // Regression: the signed-in branch used to return the existing customer
  // profile immediately, discarding the phone number the form had just required.
  const source = readFileSync("lib/bookings.ts", "utf8");
  assert.match(source, /existingBySession\.phone !== payload\.customerPhone/);
  assert.match(source, /data: \{ firstName, lastName, phone: payload\.customerPhone \}/);
  assert.match(source, /customerAddress: data\.customerAddress/);
  assert.match(source, /data: \{ address \}/);
});
