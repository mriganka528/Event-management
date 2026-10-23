import assert from "node:assert/strict";
import test from "node:test";
import { InventoryCategory } from "@prisma/client";
import {
  INVENTORY_CATEGORIES,
  applyQuantityStep,
  capacityByCategory,
  capacityForCategory,
  capacityShortfallMessage,
  formatInventoryCategory,
  inventoryCategoryOptions,
  stockLevel,
  type InventoryItemLike,
} from "@/lib/inventory";

/**
 * `lib/inventory.ts` is shared by the server and the browser, so it cannot
 * import `@prisma/client`. It therefore keeps its own copy of the category
 * list, and these tests are what stop the two from drifting apart — a missing
 * category would silently drop stock from every capacity read-out.
 */
function item(overrides: Partial<InventoryItemLike> & { id: string }): InventoryItemLike {
  return {
    name: overrides.id,
    category: "CHAIR",
    availableQuantity: 100,
    reorderLevel: 5,
    isActive: true,
    ...overrides,
  };
}

test("the shared category list matches the Prisma enum", () => {
  assert.deepEqual([...INVENTORY_CATEGORIES].sort(), Object.values(InventoryCategory).sort());
  assert.deepEqual(
    inventoryCategoryOptions().map((option) => option.value),
    Object.values(InventoryCategory),
  );
  assert.deepEqual(inventoryCategoryOptions().map((option) => option.label), [
    "Tent",
    "Chair",
    "Table",
    "Light",
    "Stage equipment",
    "Sound system",
    "Decoration",
    "Catering",
    "Photography",
    "Linen",
    "Electrical",
    "Climate control",
    "Glassware",
    "Display",
    "Video",
    "Safety",
    "Cleaning",
    "Hardware",
  ]);
});

test("every category label is spelled out, not abbreviated", () => {
  // The label is generated from the enum key, so a key that reads badly as a
  // sentence ("AV", "AC") would ship straight into the dropdowns and the
  // shortfall warnings.
  for (const option of inventoryCategoryOptions()) {
    assert.match(option.label, /^[A-Z][a-z]+( [a-z]+)*$/, `${option.value} has an unusable label`);
  }
  // The three items that had no home before this list was widened.
  assert.equal(formatInventoryCategory("CLIMATE_CONTROL"), "Climate control");
  assert.equal(formatInventoryCategory("LINEN"), "Linen");
  assert.equal(formatInventoryCategory("ELECTRICAL"), "Electrical");
});

test("formatInventoryCategory is the label every screen shares", () => {
  assert.equal(formatInventoryCategory("STAGE_EQUIPMENT"), "Stage equipment");
  assert.equal(formatInventoryCategory("CHAIR"), "Chair");
});

test("stock levels escalate from healthy to out of stock", () => {
  assert.equal(stockLevel(0, 5), "out");
  assert.equal(stockLevel(-1, 5), "out");
  // "critical" means half the reorder level (never fewer than three units);
  // "low" means up to the reorder level itself.
  assert.equal(stockLevel(2, 10), "critical");
  assert.equal(stockLevel(5, 10), "critical");
  assert.equal(stockLevel(6, 10), "low");
  assert.equal(stockLevel(10, 10), "low");
  assert.equal(stockLevel(40, 10), "healthy");
});

test("capacity sums active stock and reports the worst item in the category", () => {
  const view = capacityForCategory([
    item({ id: "a", availableQuantity: 12, reorderLevel: 5 }),
    item({ id: "b", availableQuantity: 3, reorderLevel: 10 }),
    // Archived stock cannot be reserved, so it must not raise the ceiling.
    item({ id: "c", availableQuantity: 500, isActive: false }),
  ]);

  assert.equal(view.available, 15);
  assert.equal(view.level, "critical");
  assert.equal(view.low, 1);
  assert.deepEqual(view.unavailableItems, []);
});

test("an exhausted category is reported as out of stock by name", () => {
  const view = capacityForCategory([item({ id: "d", name: "White chairs", availableQuantity: 0, reorderLevel: 5 })]);
  assert.equal(view.level, "out");
  assert.deepEqual(view.unavailableItems, ["White chairs"]);
});

test("a category with no active item behind it counts as out of stock", () => {
  assert.equal(capacityForCategory([]).level, "out");
  assert.equal(capacityForCategory([item({ id: "e", isActive: false })]).level, "out");
});

test("capacityByCategory groups items without mixing categories", () => {
  const capacity = capacityByCategory([
    item({ id: "a", category: "CHAIR", availableQuantity: 40 }),
    item({ id: "b", category: "CHAIR", availableQuantity: 2, reorderLevel: 10 }),
    item({ id: "c", category: "CATERING", availableQuantity: 8, reorderLevel: 5 }),
  ]);

  assert.equal(capacity.CHAIR.available, 42);
  assert.equal(capacity.CHAIR.level, "critical");
  assert.equal(capacity.CATERING.available, 8);
  assert.equal(capacity.CATERING.level, "healthy");
});

test("the shortfall wording is safe to show a customer", () => {
  const exhausted = capacityShortfallMessage("CHAIR", 120, 0);
  const partial = capacityShortfallMessage("STAGE_EQUIPMENT", 40, 12);

  assert.match(exhausted, /chair is fully booked/);
  // The verb agrees with the count, so the message reads correctly at 1 unit
  // and at a hundred.
  assert.match(partial, /Only 12 stage equipment units are left but this request needs 40/);
  assert.match(capacityShortfallMessage("CHAIR", 40, 1), /Only 1 chair unit is left/);
  // `publicBookingError` only forwards a message containing one of these, so the
  // customer-facing copy has to keep the wording it matches on.
  assert.ok(
    exhausted.toLowerCase().includes("is fully booked for the dates") || partial.toLowerCase().includes("left but this request needs"),
  );
});

test("a booking line can always be taken back out", () => {
  // The regression: the stepper stopped at one and disabled its own minus button
  // there, so an add-on tapped by mistake could only be undone by finding the
  // checkbox — which is itself disabled whenever the line's category reads as
  // exhausted. A customer could end up holding a line with no way to remove it,
  // and the form refuses to submit while it is there.
  const selected = { chairs: 3, fan: 1 };

  assert.deepEqual(applyQuantityStep(selected, "chairs", -1, 100), { chairs: 2, fan: 1 });
  // One below the smallest quantity is not a quantity: the line leaves.
  assert.deepEqual(applyQuantityStep(selected, "chairs", -3, 100), { fan: 1 });
  assert.deepEqual(applyQuantityStep({ fan: 1 }, "fan", -1, 100), {}, "stepping below one removes the line");

  // Another line in the same category can take the last units, which leaves this
  // one with nothing to be given. It has to go rather than sit at a quantity the
  // customer cannot undo.
  assert.deepEqual(applyQuantityStep(selected, "chairs", 1, 0), { fan: 1 });

  // Growing is still bounded by stock, and the input is never mutated.
  assert.deepEqual(applyQuantityStep(selected, "chairs", 1, 3), { chairs: 3, fan: 1 });
  assert.deepEqual(selected, { chairs: 3, fan: 1 });
  // A line nobody is asking about is left exactly as it was.
  assert.deepEqual(applyQuantityStep(selected, "tables", -1, 100), selected);
});
