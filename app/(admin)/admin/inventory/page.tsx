import Image from "next/image";
import { Archive, ArchiveRestore, ImageIcon, Plus, Trash2, Warehouse, PackageCheck, ArrowUpRight, AlertTriangle, BellRing } from "lucide-react";
import { InventoryCategory } from "@prisma/client";
import type { Metadata } from "next";
import { getAdminInventory } from "@/lib/admin-data";
import { createInventoryFormAction, deleteInventoryFormAction, setInventoryActiveFormAction } from "@/lib/form-actions";
import { AdminSearch } from "@/components/admin/admin-search";
import { ImageUploader } from "@/components/admin/image-uploader";
import { InventoryEditor } from "@/components/admin/inventory-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";
import { SuggestedInput } from "@/components/ui/suggested-input";
import { INVENTORY_NAME_SUGGESTIONS } from "@/lib/suggestions";
import { STOCK_LEVEL_CLASS, STOCK_LEVEL_LABEL, STOCK_LEVELS, formatInventoryCategory, stockLevel } from "@/lib/inventory";
import { facetValue, listFacetsFromQuery, normalizeQuery, rowFacetAttributes, rowFilterWithFacets, rowText, type ListFacet } from "@/lib/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inventory",
  description: "Track stock, reservations, and reorder thresholds for every service your events consume.",
  robots: { index: false, follow: false, nocache: true },
};

const categoryLabels = Object.values(InventoryCategory).map((category) => ({ label: formatInventoryCategory(category), value: category }));

/** Whether a record still takes part in new work. Both list screens filter on it. */
const RECORD_STATES = ["active", "archived"] as const;

/**
 * The dimensions this list can be narrowed by.
 *
 * Declared here rather than inside the toolbar so the server can read the same
 * values out of the query string that the browser offers in its selects — a
 * `?category=CHAIR` link and the dropdown have to filter identically.
 */
const inventoryFacets: readonly ListFacet[] = [
  { key: "category", label: "Category", values: Object.values(InventoryCategory), labels: Object.fromEntries(categoryLabels.map((entry) => [entry.value, entry.label])) },
  { key: "stock", label: "Stock", values: STOCK_LEVELS, labels: Object.fromEntries(STOCK_LEVELS.map((level) => [level, STOCK_LEVEL_LABEL[level]])) },
  { key: "status", label: "Status", values: RECORD_STATES, labels: { active: "Active", archived: "Archived" } },
];

function stockStatus(available: number, reorderLevel: number) {
  const level = stockLevel(available, reorderLevel);
  return { level, label: STOCK_LEVEL_LABEL[level], className: STOCK_LEVEL_CLASS[level] };
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = normalizeQuery(params.q);
  const inventory = await getAdminInventory();
  // Every row is rendered and non-matching ones are hidden, so the browser can
  // reveal them again the instant the search is cleared without a round trip.
  // The same pair of rules the toolbar applies live: text plus facets.
  const activeFacets = listFacetsFromQuery(params, inventoryFacets);
  const visibility = rowFilterWithFacets(query, activeFacets);
  const activeInventory = inventory.filter((item) => item.isActive);
  const total = activeInventory.reduce((sum, item) => sum + item.totalQuantity, 0);
  const booked = activeInventory.reduce((sum, item) => sum + item.bookedQuantity, 0);
  const available = activeInventory.reduce((sum, item) => sum + item.availableQuantity, 0);
  const low = activeInventory.filter((item) => item.availableQuantity <= item.reorderLevel);
  const exhausted = activeInventory.filter((item) => item.availableQuantity <= 0);
  const categories = Array.from(new Set(activeInventory.map((item) => item.category))).map((category) => {
    const items = activeInventory.filter((item) => item.category === category);
    return { category, total: items.reduce((sum, item) => sum + item.totalQuantity, 0), available: items.reduce((sum, item) => sum + item.availableQuantity, 0) };
  });

  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search inventory"
        placeholder="Search by item name, slug, or category…"
        facets={inventoryFacets}
      />
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Inventory control</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Know what is available.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Track stock, reservations, and reorder thresholds from the same source used during booking approval. Archived items remain available for audit but are excluded from new reservations.</p></div><a href="#add-inventory"><Button><Plus className="mr-2 h-4 w-4" />Add inventory</Button></a></section>
      {low.length > 0 ? (
        <section
          role="alert"
          aria-live="polite"
          className="rounded-[24px] border border-[var(--warning-text)]/30 bg-[var(--warning-soft)] p-5 text-[var(--warning-text)]"
        >
          <p className="flex items-center gap-2 font-semibold">
            <BellRing className="h-5 w-5" />
            {exhausted.length > 0
              ? `${exhausted.length} item${exhausted.length === 1 ? " is" : "s are"} out of stock`
              : `${low.length} item${low.length === 1 ? " is" : "s are"} low on stock`}
          </p>
          <p className="mt-2 text-sm">
            {exhausted.map((item) => `${item.name} (${formatInventoryCategory(item.category).toLowerCase()})`).join(", ")}
            {exhausted.length > 0 ? " " : ""}
            {low.filter((item) => item.availableQuantity > 0).map((item) => `${item.name}: ${item.availableQuantity} left (reorder at ${item.reorderLevel})`).join(" · ")}
            . Services linked to these categories cannot be booked until stock is restored — every admin has also been notified.
          </p>
        </section>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{ label: "Total units", value: total, icon: Warehouse }, { label: "Booked units", value: booked, icon: PackageCheck }, { label: "Available now", value: available, icon: ArrowUpRight }, { label: "Needs attention", value: low.length, icon: AlertTriangle }].map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-semibold">{value.toLocaleString("en-IN")}</p></div><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><Icon className="h-5 w-5" /></span></div></CardContent></Card>)}</section>
      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-stone-100">
            <CardTitle className="text-2xl">Stock catalog</CardTitle>
            <CardDescription>Available quantities update when an approved booking reserves stock.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {inventory.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No inventory yet" description="Add your first stock item to start tracking event capacity." />
              </div>
            ) : (
              /*
                `min-w-*` on the table is what makes this responsive rather than
                broken. Without a floor the auto layout squeezes every column to
                fit the viewport, and short values like "category" get wrapped
                mid-word — "cate" / "gory". With a floor the container scrolls
                sideways instead and each column keeps the width its content
                needs. `whitespace-nowrap` then stops the one-word cells from
                breaking even when someone shrinks the window further.
              */
              <div className="overflow-x-auto">
                <Table className="min-w-[880px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Item</TableHead>
                      <TableHead className="whitespace-nowrap">Category</TableHead>
                      <TableHead className="whitespace-nowrap">Stock</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Manage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((item) => {
                      const status = stockStatus(item.availableQuantity, item.reorderLevel);
                      const searchText = rowText(item.name, item.slug, item.category, formatInventoryCategory(item.category));
                      // The values the toolbar's selects match against, read back
                      // out of the DOM by `AdminSearch`.
                      const facets = {
                        category: facetValue(item.category),
                        stock: status.level,
                        status: item.isActive ? "active" : "archived",
                      };

                      return (
                        <TableRow key={item.id} data-row-id={item.id} data-row-text={searchText} {...rowFacetAttributes(facets)} style={visibility(searchText, facets)}>
                          <TableCell>
                            <div className="flex min-w-[240px] items-center gap-3">
                              <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-[var(--surface)]">
                                {item.imageUrl ? (
                                  <Image src={item.imageUrl} alt={item.name} fill sizes="64px" unoptimized className="object-cover" />
                                ) : (
                                  <ImageIcon className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-[var(--muted)]" />
                                )}
                              </div>
                              <div className="min-w-0">
                                {/* Only genuinely long values wrap: the item name.
                                    Everything else is a single token or a short
                                    phrase and is kept whole. */}
                                <p className="font-semibold">{item.name}</p>
                                <p className="truncate text-sm text-stone-500">{item.slug}</p>
                                {!item.isActive ? <Badge className="mt-1 bg-stone-900 text-white">Archived</Badge> : null}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="whitespace-nowrap capitalize">{item.category.toLowerCase().replaceAll("_", " ")}</TableCell>

                          <TableCell className="whitespace-nowrap">
                            <p className="font-medium">{item.availableQuantity} available</p>
                            <p className="text-sm text-stone-500">{item.bookedQuantity} booked · {item.totalQuantity} total</p>
                            <p className="text-xs text-stone-400">Reorder at {item.reorderLevel}</p>
                          </TableCell>

                          <TableCell className="whitespace-nowrap">
                            <Badge className={status.className}>{status.label}</Badge>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <ActionForm action={setInventoryActiveFormAction}>
                                <input type="hidden" name="id" value={item.id} />
                                <input type="hidden" name="isActive" value={item.isActive ? "false" : "true"} />
                                <Button type="submit" size="sm" variant="outline">
                                  {item.isActive ? <Archive className="mr-2 h-4 w-4" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
                                  {item.isActive ? "Archive" : "Restore"}
                                </Button>
                              </ActionForm>
                              <ActionForm action={deleteInventoryFormAction}>
                                <input type="hidden" name="id" value={item.id} />
                                <Button type="submit" size="sm" variant="destructive">
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </Button>
                              </ActionForm>
                              <InventoryEditor
                                item={{
                                  id: item.id,
                                  name: item.name,
                                  slug: item.slug,
                                  category: item.category,
                                  totalQuantity: item.totalQuantity,
                                  bookedQuantity: item.bookedQuantity,
                                  availableQuantity: item.availableQuantity,
                                  reorderLevel: item.reorderLevel,
                                  imageUrl: item.imageUrl,
                                  imagePublicId: item.imagePublicId,
                                  isActive: item.isActive,
                                }}
                                categoryOptions={categoryLabels}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="space-y-6"><Card id="add-inventory"><CardHeader><CardTitle>Add inventory</CardTitle><CardDescription>Create a stock item that booking approval can reserve.</CardDescription></CardHeader><CardContent><ActionForm action={createInventoryFormAction} className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Item name<SuggestedInput list="inventory-name-suggestions" suggestions={INVENTORY_NAME_SUGGESTIONS} name="name" placeholder="Start typing or choose an item" required /></label><label className="grid gap-2 text-sm font-medium">Category<SearchableSelect name="category" options={categoryLabels} required placeholder="Search categories…" /></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm font-medium">Total quantity<Input name="totalQuantity" type="number" min="0" defaultValue="1" required /></label><label className="grid gap-2 text-sm font-medium">Reorder level<Input name="reorderLevel" type="number" min="0" defaultValue="5" required /></label></div><ImageUploader folder="inventory" label="Inventory image" /><SubmitButton className="w-full"><Plus className="mr-2 h-4 w-4" />Add item</SubmitButton></ActionForm></CardContent></Card><Card><CardHeader><CardTitle>Category pressure</CardTitle><CardDescription>Utilization by inventory category.</CardDescription></CardHeader><CardContent className="grid gap-3">{categories.length === 0 ? <p className="text-sm text-[var(--muted)]">No categories yet.</p> : categories.map((item) => <div key={item.category} className="rounded-2xl bg-stone-50 p-4"><div className="flex justify-between gap-3"><p className="font-medium capitalize">{item.category.toLowerCase().replaceAll("_", " ")}</p><span className="text-sm text-[var(--muted)]">{item.total ? Math.round(((item.total - item.available) / item.total) * 100) : 0}% busy</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-amber-500" style={{ width: `${item.total ? ((item.total - item.available) / item.total) * 100 : 0}%` }} /></div><p className="mt-2 text-xs text-[var(--muted)]">{item.available} of {item.total} units available</p></div>)}</CardContent></Card></div>
      </section>
    </main>
  );
}
