import assert from "node:assert/strict";
import test from "node:test";
import { calculateBookingPrice } from "@/lib/pricing";
import { collectInventoryRequirements, inventoryCategoriesOf } from "@/lib/inventory";

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

test("a per-day service is billed and drawn for each day", () => {
  const services = [
    { id: "crockery", name: "Crockery", slug: "crockery", basePrice: 50, pricingMode: "PER_DAY" as const },
    { id: "tent", name: "Tent", slug: "tent", basePrice: 1000, pricingMode: "FIXED" as const },
  ];

  const threeDays = calculateBookingPrice({
    services,
    selectedServices: [
      { serviceId: "crockery", quantity: 2 },
      { serviceId: "tent", quantity: 1 },
    ],
    guestCount: 100,
    durationDays: 3,
  });
  // Two per day for three days, not two in total.
  assert.equal(threeDays.serviceLines[0].quantity, 6);
  assert.equal(threeDays.serviceLines[1].quantity, 1, "a fixed line must not scale with the day count");
  assert.equal(threeDays.subtotal, 1300);

  // A caller that predates per-day pricing, or a single-day event, still prices
  // one day rather than zero.
  const single = calculateBookingPrice({
    services,
    selectedServices: [{ serviceId: "crockery", quantity: 2 }],
    guestCount: 100,
  });
  assert.equal(single.serviceLines[0].quantity, 2);
  assert.equal(calculateBookingPrice({ services, selectedServices: [{ serviceId: "crockery", quantity: 2 }], guestCount: 100, durationDays: 0 }).serviceLines[0].quantity, 2);
});

test("a service draws on every category it is linked to", () => {
  // The regression this whole change exists for: a table-and-chair arrangement
  // could only be linked to one category, so the reservation that guards stock
  // never saw the tables. It could be booked against 200 chairs with no tables in
  // the building.
  const requirements = collectInventoryRequirements({
    guestCount: 100,
    serviceLines: [{ inventoryCategories: ["TABLE", "CHAIR"], quantity: 40 }],
    packageLines: [],
  });

  assert.equal(requirements.get("TABLE"), 40, "one unit of each linked category per unit of the service");
  assert.equal(requirements.get("CHAIR"), 40);

  // Lines sharing a category compete for the same stock rather than overwriting
  // each other.
  const shared = collectInventoryRequirements({
    guestCount: 100,
    serviceLines: [
      { inventoryCategories: ["TABLE", "CHAIR"], quantity: 40 },
      { inventoryCategories: ["CHAIR"], quantity: 25 },
      { inventoryCategories: ["STAGE_EQUIPMENT"], quantity: 2 },
    ],
    packageLines: [],
  });
  assert.equal(shared.get("CHAIR"), 65);
  assert.equal(shared.get("TABLE"), 40);
  assert.equal(shared.get("STAGE_EQUIPMENT"), 2);

  // A package bundle scales each of its own categories by the guest count.
  const bundled = collectInventoryRequirements({
    guestCount: 50,
    serviceLines: [],
    packageLines: [{ quantity: 2, pricingMode: "PER_GUEST", inventoryCategories: ["TABLE", "CHAIR"] }],
  });
  assert.equal(bundled.get("TABLE"), 100);
  assert.equal(bundled.get("CHAIR"), 100);
});

test("a snapshot written before the list still reserves its stock", () => {
  // Package snapshots are re-read at approval time to reserve inventory, and the
  // ones already stored carry a single `inventoryCategory` string rather than the
  // list. Reading only the list would make those packages reserve nothing, so a
  // booking accepted this year would quietly stop holding the stock it was
  // quoted against.
  const requirements = collectInventoryRequirements({
    guestCount: 100,
    serviceLines: [],
    packageLines: [
      { quantity: 2, pricingMode: "PER_GUEST", inventoryCategory: "CHAIR" },
      { quantity: 1, pricingMode: "FIXED", inventoryCategory: "STAGE_EQUIPMENT" },
      { quantity: 3, pricingMode: "FIXED" },
      { quantity: 1, pricingMode: "FIXED", inventoryCategories: [] },
    ],
  });

  assert.equal(requirements.get("CHAIR"), 200);
  assert.equal(requirements.get("STAGE_EQUIPMENT"), 1);
  assert.equal(requirements.size, 2, "a line with no stock link contributes nothing");

  // The same reader, used directly, accepts either shape.
  assert.deepEqual(inventoryCategoriesOf({ inventoryCategories: ["TABLE", "CHAIR"] }), ["TABLE", "CHAIR"]);
  assert.deepEqual(inventoryCategoriesOf({ inventoryCategory: "CHAIR" }), ["CHAIR"]);
  assert.deepEqual(inventoryCategoriesOf({ inventoryCategories: [], inventoryCategory: "CHAIR" }), [], "the list wins when both are present");
  assert.deepEqual(inventoryCategoriesOf(null), []);
  assert.deepEqual(inventoryCategoriesOf({}), []);
});

test("per-day stock is reserved per day, from the quote and from a package", () => {
  // Two lines in one category must add up rather than overwrite each other, and
  // a package's stored quantity is a multiplier, not a unit count.
  const requirements = collectInventoryRequirements({
    guestCount: 100,
    durationDays: 3,
    serviceLines: [
      { inventoryCategories: ["GLASSWARE"], quantity: 6 },
      { inventoryCategories: ["CHAIR"], quantity: 300 },
    ],
    packageLines: [
      { quantity: 2, pricingMode: "PER_DAY", inventoryCategories: ["GLASSWARE"] },
      { quantity: 1, pricingMode: "PER_GUEST", inventoryCategories: ["CHAIR"] },
      { quantity: 4, pricingMode: "FIXED", inventoryCategories: ["TABLE"] },
    ],
  });

  assert.equal(requirements.get("GLASSWARE"), 12, "six from the chosen line plus two per day for three days");
  assert.equal(requirements.get("CHAIR"), 400);
  assert.equal(requirements.get("TABLE"), 4, "a fixed package line is already a unit count");

  // A booking stored before per-day pricing exists has no days to multiply by.
  const legacy = collectInventoryRequirements({
    guestCount: 50,
    serviceLines: [{ inventoryCategories: ["CHAIR"], quantity: 50 }],
    packageLines: [{ quantity: 2, pricingMode: "PER_DAY", inventoryCategories: ["CHAIR"] }],
  });
  assert.equal(legacy.get("CHAIR"), 52);
});
