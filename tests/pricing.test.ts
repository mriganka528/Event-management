import assert from "node:assert/strict";
import test from "node:test";
import { calculateBookingPrice } from "@/lib/pricing";

test("calculates per-person services and tax from trusted prices", () => {
  const result = calculateBookingPrice({
    services: [
      { id: "chairs", name: "Chairs", slug: "chairs", basePrice: 100 },
      { id: "tent", name: "Tent", slug: "tent", basePrice: 1000 },
    ],
    selectedServices: [
      { serviceId: "chairs", quantity: 1 },
      { serviceId: "tent", quantity: 1 },
    ],
    guestCount: 20,
    taxRate: 0.18,
  });
  assert.equal(result.serviceLines[0].quantity, 20);
  assert.equal(result.subtotal, 3000);
  assert.equal(result.totalAmount, 3540);
});

test("deduplicates repeated service selections", () => {
  const result = calculateBookingPrice({
    services: [{ id: "tent", name: "Tent", slug: "tent", basePrice: 1000 }],
    selectedServices: [
      { serviceId: "tent", quantity: 1 },
      { serviceId: "tent", quantity: 2 },
    ],
    guestCount: 20,
  });
  assert.equal(result.serviceLines.length, 1);
  assert.equal(result.subtotal, 2000);
});
