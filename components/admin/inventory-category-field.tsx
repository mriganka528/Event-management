"use client";

import { useState } from "react";
import { CircleAlert, Info } from "lucide-react";
import { MultiSearchableSelect } from "@/components/ui/multi-searchable-select";
import { STOCK_LEVEL_CLASS, STOCK_LEVEL_LABEL, formatInventoryCategory, type CapacityView } from "@/lib/inventory";

/**
 * Inventory-category picker with a live stock read-out.
 *
 * A service is only as bookable as the stock behind it, so the category is never
 * presented as a plain list: the moment categories are chosen the field says
 * whether they have stock, are running low, or cannot back the service at all.
 * The read-out follows the selection, not the initial value, so an admin who
 * changes their mind sees the consequence before saving.
 *
 * Several categories can be linked at once, because most services in this trade
 * need more than one kind of thing — a table-and-chair arrangement draws a table
 * and a chair per unit, and the booking form reserves one of *each* it is linked
 * to. A service that could only name one had the rest of what it consumes
 * invisible to the stock check.
 *
 * The list itself is searchable. It has to be: the category list is long enough
 * that scrolling it on a phone is a chore, and an admin looking for the cable has
 * to be able to type "cable" rather than read every row.
 */
export function InventoryCategoryField({
  name = "inventoryCategories",
  label = "Inventory categories",
  options,
  capacity,
  defaultValues = [],
  hint,
  onValuesChange,
}: {
  name?: string;
  label?: string;
  options: readonly { label: string; value: string }[];
  capacity: Record<string, CapacityView>;
  defaultValues?: readonly string[];
  hint?: string;
  /** Called with the new categories, so a dialog can count this as a real edit. */
  onValuesChange?: (values: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([...defaultValues]);
  // A category with no active item behind it counts as out of stock, which is
  // exactly how `capacityForCategory` reports an empty bucket.
  const views = selected.map((category) => ({ category, view: capacity[category] }));
  const missing = views.filter((entry) => !entry.view);
  const exhausted = views.filter((entry) => entry.view?.level === "out");
  const low = views.filter((entry) => entry.view && entry.view.level !== "healthy" && entry.view.level !== "out");
  const describe = (category: string) => formatInventoryCategory(category).toLowerCase();
  const list = (entries: typeof views) => entries.map((entry) => describe(entry.category)).join(", ");

  return (
    <div className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {/*
        A button click fires neither `change` nor `input`, so the dialogs that
        keep Save disabled until something has been touched cannot rely on the
        form's own handlers here. Both sides are notified instead.
      */}
      <MultiSearchableSelect
        name={name}
        options={options}
        values={selected}
        onValuesChange={(next) => {
          setSelected(next);
          onValuesChange?.(next);
        }}
        placeholder="Search categories…"
        emptyLabel="No inventory link"
      />
      {hint ? <p className="text-xs font-normal text-[var(--muted)]">{hint}</p> : null}

      {missing.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-2xl bg-[var(--danger-soft)] px-3 py-2 text-xs font-normal text-[var(--danger-text)]">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            No active inventory item uses {list(missing)}. This service cannot be reserved for a booking until stock is added.
          </span>
        </p>
      ) : exhausted.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-2xl bg-[var(--danger-soft)] px-3 py-2 text-xs font-normal text-[var(--danger-text)]">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {exhausted.map((entry) => `${describe(entry.category)} is fully reserved`).join(", ")}. Bookings that need{" "}
            {exhausted.length === 1 ? "it" : "them"} will be refused until it is restocked
            {exhausted.some((entry) => entry.view?.unavailableItems.length) ? ` (${exhausted.flatMap((entry) => entry.view?.unavailableItems ?? []).join(", ")})` : ""}.
          </span>
        </p>
      ) : low.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-2xl bg-[var(--warning-soft)] px-3 py-2 text-xs font-normal text-[var(--warning-text)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Low stock: {low.map((entry) => `${entry.view?.available} of ${describe(entry.category)} left`).join(", ")}.
          </span>
        </p>
      ) : selected.length > 0 ? (
        <p className={`inline-flex w-fit flex-wrap items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${STOCK_LEVEL_CLASS.healthy}`}>
          {STOCK_LEVEL_LABEL.healthy} ·{" "}
          {views.map((entry) => `${entry.view?.available} ${describe(entry.category)}`).join(" + ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Read-only badge on a service card.
 *
 * A service linked to several categories is only as bookable as its tightest one,
 * so the badge reports the worst of them and names the category — a single green
 * pill for a service that also draws on an empty category would be a lie.
 */
export function StockBadge({ categories, capacity }: { categories: readonly string[]; capacity: Record<string, CapacityView> }) {
  if (categories.length === 0) return <span className="text-xs text-[var(--muted)]">No inventory link</span>;
  const entries = categories.map((category) => ({ category, view: capacity[category] }));
  const worst = entries.reduce((lowest, entry) => {
    const level = entry.view?.level ?? "out";
    const rank = { out: 0, critical: 1, low: 2, healthy: 3 } as const;
    return rank[level] < rank[lowest] ? level : lowest;
  }, "healthy" as keyof typeof STOCK_LEVEL_CLASS);
  const blocking = entries.filter((entry) => (entry.view?.level ?? "out") === worst);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${STOCK_LEVEL_CLASS[worst]}`}>
      {STOCK_LEVEL_LABEL[worst]} ·{" "}
      {blocking.length === 1 ? formatInventoryCategory(blocking[0].category).toLowerCase() : `${blocking.length} categories`}
    </span>
  );
}
