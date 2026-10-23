/**
 * Stock reasoning shared by the admin catalog, the inventory screen, and the
 * public booking form.
 *
 * This is a plain module on purpose: the rules must be identical on the server
 * (where a booking is refused when it would oversubscribe stock) and in the
 * browser (where the quantity stepper stops at the limit), otherwise the UI
 * would happily offer a service the server then rejects. It therefore imports
 * nothing from `@prisma/client`, which would drag the generated client into
 * the browser bundle. `tests/inventory.test.ts` keeps the list in step with the
 * `InventoryCategory` enum.
 */

export type StockLevel = "out" | "critical" | "low" | "healthy";

/** Mirrors the `InventoryCategory` enum in `prisma/schema.prisma`. */
export const INVENTORY_CATEGORIES = [
  "TENT",
  "CHAIR",
  "TABLE",
  "LIGHT",
  "STAGE_EQUIPMENT",
  "SOUND_SYSTEM",
  "DECORATION",
  "CATERING",
  "PHOTOGRAPHY",
  // The categories below exist because the original nine left common equipment
  // with nowhere to go, and an item filed under the nearest wrong category still
  // reads as a healthy count in a capacity report that nothing checks.
  //
  // LINEN            white and coloured tablecloths, chair covers, carpets, draping
  // ELECTRICAL       extension cables, power strips, distribution boards, generators
  // CLIMATE_CONTROL  electric fans, air coolers, heaters, air conditioners
  // GLASSWARE        plates, glasses, cutlery, steel dishes that are counted, not consumed
  // DISPLAY          banners, standees, roll-ups, backdrops, direction boards
  // VIDEO            projectors, projector screens, LED TVs
  // SAFETY           fire extinguishers, first aid boxes, emergency lights, exit signs
  // CLEANING         mops, buckets, dustbins, vacuum cleaners
  // HARDWARE         ladders, ropes, tool boxes, cable ties, drills
  "LINEN",
  "ELECTRICAL",
  "CLIMATE_CONTROL",
  "GLASSWARE",
  "DISPLAY",
  "VIDEO",
  "SAFETY",
  "CLEANING",
  "HARDWARE",
] as const;

export type InventoryCategoryKey = (typeof INVENTORY_CATEGORIES)[number];

export type CapacityView = {
  /** Units that can still be reserved right now. */
  available: number;
  /** Items below or equal to the reorder level, which is what triggers a warning. */
  low: number;
  /** Individual item names that are already exhausted. */
  unavailableItems: string[];
  level: StockLevel;
};

/** `STAGE_EQUIPMENT` -> `Stage equipment`, used everywhere a category is shown. */
export function formatInventoryCategory(category: string) {
  const words = category.toLowerCase().replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function inventoryCategoryOptions() {
  return INVENTORY_CATEGORIES.map((category) => ({ label: formatInventoryCategory(category), value: category }));
}

export function stockLevel(available: number, reorderLevel: number): StockLevel {
  if (available <= 0) return "out";
  if (available <= Math.max(3, Math.floor(reorderLevel / 2))) return "critical";
  if (available <= reorderLevel) return "low";
  return "healthy";
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = {
  out: "Out of stock",
  critical: "Critical",
  low: "Low stock",
  healthy: "Healthy",
};

export const STOCK_LEVEL_CLASS: Record<StockLevel, string> = {
  out: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  critical: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  low: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  healthy: "bg-[var(--success-soft)] text-[var(--success-text)]",
};

/**
 * Every stock level, worst first — the order a filter wants them offered in, and
 * the list the server validates a `?stock=` value against.
 */
export const STOCK_LEVELS = ["out", "critical", "low", "healthy"] as const satisfies readonly StockLevel[];

type InventorySnapshot = {
  id: string;
  name: string;
  category: InventoryCategoryKey | string;
  totalQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  isActive: boolean;
};

export type InventoryItemLike = Pick<InventorySnapshot, "id" | "name" | "category" | "availableQuantity" | "reorderLevel" | "isActive">;

const LEVEL_RANK: Record<StockLevel, number> = { healthy: 0, low: 1, critical: 2, out: 3 };

/**
 * Everything the UI needs to warn about one inventory category in a single
 * object. `available` is the sum across active items, which is what a booking
 * reservation actually competes for.
 */
export function capacityForCategory(items: readonly InventoryItemLike[]): CapacityView {
  const active = items.filter((item) => item.isActive);
  const available = active.reduce((sum, item) => sum + Math.max(0, item.availableQuantity), 0);
  const low = active.filter((item) => stockLevel(item.availableQuantity, item.reorderLevel) !== "healthy").length;
  const unavailableItems = active.filter((item) => item.availableQuantity <= 0).map((item) => item.name);
  const worst = active.reduce<StockLevel>(
    (level, item) => {
      const next = stockLevel(item.availableQuantity, item.reorderLevel);
      return LEVEL_RANK[next] > LEVEL_RANK[level] ? next : level;
    },
    // A category with nothing active behind it is an outage, not a healthy zero.
    active.length === 0 ? "out" : "healthy",
  );

  return { available, low, unavailableItems, level: worst };
}

export function capacityByCategory(items: readonly InventoryItemLike[]): Record<string, CapacityView> {
  const grouped = new Map<string, InventoryItemLike[]>();
  for (const item of items) {
    const key = String(item.category);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return Object.fromEntries([...grouped].map(([category, bucket]) => [category, capacityForCategory(bucket)]));
}

/**
 * How many units of each inventory category a booking needs.
 *
 * Both halves of a quote are folded in: the individually chosen services (whose
 * stored quantity already carries the guest count for per-person services and the
/**
 * A stored quote line, in either the current or the pre-list shape.
 *
 * `inventoryCategories` is the live field; `inventoryCategory` is the single
 * value a snapshot taken before the list existed still carries. Both are read by
 * `inventoryCategoriesOf`, so a caller can hand over a Prisma row or an old JSON
 * snapshot without converting it first.
 */
export type InventoryRequirementLine = {
  quantity: number;
  pricingMode?: string | null;
  inventoryCategories?: readonly string[] | string | null;
  inventoryCategory?: string | null;
};

/**
 * Just the two shapes a stored line can carry its categories in, for callers that
 * are only asking what a line draws on.
 */
export type StockCategorySource = Pick<InventoryRequirementLine, "inventoryCategories" | "inventoryCategory">;

/**
 * The stock categories a stored line draws on, whatever shape it is in.
 *
 * A service used to hold one category, and the snapshot taken on a package still
 * holds that single string in JSON. Those rows are re-read at approval time — the
 * inventory reservation is recomputed from the snapshot rather than from the
 * service, so a package quoted last year must not start reserving nothing —
 * so the old shape has to be understood here rather than in one call site.
 */
export function inventoryCategoriesOf(line: StockCategorySource | null | undefined): string[] {
  if (!line) return [];
  if (Array.isArray(line.inventoryCategories)) return line.inventoryCategories.filter((category): category is string => typeof category === "string" && category.length > 0);
  // Written before the list existed: one category, or none.
  if (typeof line.inventoryCategory === "string" && line.inventoryCategory) return [line.inventoryCategory];
  return [];
}

/**
 * How many units of each inventory category a booking needs.
 *
 * A service can draw on several categories, and it draws on **all** of them: one
 * unit of a table-and-chair arrangement is a table *and* a chair. Each line
 * therefore adds its quantity to every category it is linked to, and the totals
 * add up across lines so two services sharing a category compete for the same
 * stock.
 *
 * Both halves of a quote are folded in: the individually chosen services (whose
 * stored quantity already carries the guest count for per-person services and the
 * day count for per-day ones) and the package bundle (whose stored quantity is a
 * multiplier, so per-person lines still have to be scaled by the guest count and
 * per-day lines by the number of days).
 *
 * It lives here rather than beside the booking write because the browser has to
 * reach the same arithmetic to stop a stepper at the real limit, and this module
 * is the one that both ends can import.
 */
export function collectInventoryRequirements({
  guestCount,
  durationDays = 1,
  serviceLines,
  packageLines,
}: {
  guestCount: number;
  /** Only `PER_DAY` lines read it; older callers and stored rows leave it out. */
  durationDays?: number;
  serviceLines: readonly InventoryRequirementLine[];
  packageLines: readonly InventoryRequirementLine[];
}): Map<string, number> {
  const requirements = new Map<string, number>();
  const days = Math.max(1, Math.round(Number.isFinite(durationDays) ? durationDays : 1));
  const add = (category: string | null | undefined, quantity: number) => {
    if (!category || !Number.isFinite(quantity) || quantity <= 0) return;
    requirements.set(category, (requirements.get(category) ?? 0) + Math.round(quantity));
  };

  for (const line of serviceLines) {
    for (const category of inventoryCategoriesOf(line)) add(category, line.quantity);
  }
  for (const line of packageLines) {
    const perDay = line.pricingMode === "PER_DAY" ? days : line.pricingMode === "PER_GUEST" ? guestCount : 1;
    for (const category of inventoryCategoriesOf(line)) add(category, line.quantity * perDay);
  }
  return requirements;
}

/**
 * The single wording used everywhere a service cannot be promised because its
 * stock is gone. `publicBookingError` in `lib/actions.ts` forwards this text to
 * the customer, so it must stay readable without admin context.
 */
export function capacityShortfallMessage(category: string, required: number, available: number) {
  const label = formatInventoryCategory(category).toLowerCase();
  if (available <= 0) return `${label} is fully booked for the dates you selected. Please choose a different service or contact us for a custom plan.`;
  return `Only ${available} ${label} unit${available === 1 ? "" : "s"} ${available === 1 ? "is" : "are"} left but this request needs ${required}. Please reduce the quantity or contact us for a custom plan.`;
}

/**
 * Applies one step of a booking line's quantity stepper, where zero means "not
 * part of this request".
 *
 * A stepper that stops at one cannot be undone from the stepper. The customer
 * who mis-clicked an add-on has to find the checkbox to get rid of it, and where
 * that checkbox is disabled — an exhausted category refuses new lines, so a
 * line can end up selected against a category that has since run dry — the line
 * cannot be removed at all and the form is stuck. Stepping below one therefore
 * drops the line, which is the rule that keeps every selected line reversible.
 *
 * `limit` is how many units this line may still claim; a line left with none is
 * dropped for the same reason.
 */
export function applyQuantityStep(
  selection: Record<string, number>,
  serviceId: string,
  delta: number,
  limit: number,
): Record<string, number> {
  const next = (selection[serviceId] ?? 0) + delta;
  const updated = { ...selection };
  if (next < 1 || limit < 1) {
    delete updated[serviceId];
    return updated;
  }
  updated[serviceId] = Math.min(limit, next);
  return updated;
}

