import type { Metadata } from "next";
import Image from "next/image";
import { Archive, ArchiveRestore, ImageIcon, Plus, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { PricingMode } from "@prisma/client";
import { getAdminInventory, getAdminServices } from "@/lib/admin-data";
import {
  createServiceFormAction,
  deleteServiceFormAction,
  setServiceActiveFormAction,
} from "@/lib/form-actions";
import { ImageUploader } from "@/components/admin/image-uploader";
import { AdminSearch } from "@/components/admin/admin-search";
import { InventoryCategoryField, StockBadge } from "@/components/admin/inventory-category-field";
import { ServiceEditor } from "@/components/admin/service-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { formatCurrency } from "@/lib/utils";
import { ActionForm } from "@/components/forms/action-form";
import { SuggestedInput } from "@/components/ui/suggested-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SERVICE_NAME_SUGGESTIONS, UNIT_LABEL_OPTIONS } from "@/lib/suggestions";
import { capacityByCategory, formatInventoryCategory, inventoryCategoryOptions, STOCK_LEVELS, STOCK_LEVEL_LABEL, type CapacityView, type StockLevel } from "@/lib/inventory";
import { facetValue, listFacetsFromQuery, normalizeQuery, rowFacetAttributes, rowFilterWithFacets, rowText, type ListFacet } from "@/lib/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services",
  description: "Create and edit the services your events can include, and link each one to the stock it consumes.",
  robots: { index: false, follow: false, nocache: true },
};

const pricingOptions = [
  { label: "Fixed price", value: PricingMode.FIXED },
  { label: "Per guest", value: PricingMode.PER_GUEST },
  { label: "Per day", value: PricingMode.PER_DAY },
];

/** The second half of a service card's price line: how the amount is charged. */
function pricingModeSummary(pricingMode: PricingMode) {
  if (pricingMode === PricingMode.PER_GUEST) return "per guest";
  if (pricingMode === PricingMode.PER_DAY) return "per day";
  return "fixed";
}

/** Whether a record still takes part in new work. Both list screens filter on it. */
const RECORD_STATES = ["active", "archived"] as const;

/**
 * The dimensions this list can be narrowed by.
 *
 * A service is filterable by every category it is linked to, so the category
 * filter finds a table-and-chair arrangement under either of them.
 */
const serviceFacets: readonly ListFacet[] = [
  { key: "category", label: "Category", values: inventoryCategoryOptions().map((option) => option.value), labels: Object.fromEntries(inventoryCategoryOptions().map((option) => [option.value, option.label])) },
  { key: "pricing", label: "Pricing", values: Object.values(PricingMode), labels: { FIXED: "Fixed price", PER_GUEST: "Per guest", PER_DAY: "Per day" } },
  { key: "stock", label: "Stock", values: STOCK_LEVELS, labels: Object.fromEntries(STOCK_LEVELS.map((level) => [level, STOCK_LEVEL_LABEL[level]])) },
  { key: "status", label: "Status", values: RECORD_STATES, labels: { active: "Active", archived: "Archived" } },
];

/** The worst stock level across a service's categories: what bounds it. */
function worstStockLevel(categories: readonly string[], capacity: Record<string, CapacityView>): StockLevel {
  let worst: StockLevel = "healthy";
  for (const category of categories) {
    const level = capacity[category]?.level ?? "out";
    if (STOCK_LEVELS.indexOf(level) < STOCK_LEVELS.indexOf(worst)) worst = level;
  }
  return categories.length === 0 ? "healthy" : worst;
}

export default async function ServicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = normalizeQuery(params.q);
  const [services, inventory] = await Promise.all([getAdminServices(), getAdminInventory()]);
  const capacity = capacityByCategory(inventory);
  // Every row is rendered; a non-matching one is simply hidden. That keeps the
  // first paint of a shared `?q=` link narrow without leaving the browser unable
  // to reveal the rest when the search is cleared.
  const activeFacets = listFacetsFromQuery(params, serviceFacets);
  const visibility = rowFilterWithFacets(query, activeFacets);

  // Services that cannot be promised right now, surfaced at the top rather than
  // discovered on the day of the event. Deliberately built from the full list,
  // so a search cannot hide an outage.
  //
  // A service linked to several categories is blocked when *any* of them is out:
  // a table-and-chair arrangement with no chairs left cannot be promised just
  // because the tables are free.
  const blockedServices = services.flatMap((service) => {
    if (!service.isActive) return [];
    const exhausted = service.inventoryCategories.filter((category) => (capacity[category]?.level ?? "out") === "out");
    if (exhausted.length === 0) return [];
    return [{ id: service.id, name: service.name, categoryLabel: exhausted.map((category) => formatInventoryCategory(category).toLowerCase()).join(", ") }];
  });

  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search services"
        placeholder="Search by service name, description, unit, or stock category…"
        facets={serviceFacets}
      />
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Service catalog</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Everything your team delivers.</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Services power both custom quotes and package bundles. Upload service artwork to Cloudinary and archive retired services
            without breaking booking history.
          </p>
        </div>
        <a href="#create-service">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add service
          </Button>
        </a>
      </section>

      {blockedServices.length > 0 ? (
        <section
          role="alert"
          className="rounded-[24px] border border-[var(--danger-text)]/30 bg-[var(--danger-soft)] p-5 text-[var(--danger-text)]"
        >
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-5 w-5" />
            {blockedServices.length} service{blockedServices.length === 1 ? "" : "s"} cannot be booked right now
          </p>
          <p className="mt-2 text-sm">
            {blockedServices.map((service) => `${service.name} (${service.categoryLabel} stock exhausted)`).join(", ")}
            {blockedServices.length === 1 ? " is" : " are"} unavailable. Restock the linked inventory on the Inventory screen, or unlink the category, before offering {blockedServices.length === 1 ? "this service" : "these services"} again.
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {services.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState title="No services configured" description="Add the services your events can include." />
          </div>
        ) : (
          services.map((service) => {
            const searchText = rowText(service.name, service.slug, service.description, service.unitLabel, service.inventoryCategories.join(" "));
            const facets = {
              // Every category the service is linked to, so the filter finds it
              // under any one of them.
              category: facetValue(...service.inventoryCategories),
              pricing: service.pricingMode,
              stock: worstStockLevel(service.inventoryCategories, capacity),
              status: service.isActive ? "active" : "archived",
            };

            return (
              <Card
                key={service.id}
                data-row-id={service.id}
                data-row-text={searchText}
                {...rowFacetAttributes(facets)}
                style={visibility(searchText, facets)}
                className="flex flex-col overflow-hidden"
              >
                <div className="relative aspect-[16/6] bg-[var(--surface)]">
                  {service.imageUrl ? (
                    <Image
                      src={service.imageUrl}
                      alt={service.name}
                      fill
                      sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[var(--muted)]">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                  {!service.isActive ? <Badge className="absolute left-4 top-4 bg-stone-900 text-white">Archived</Badge> : null}
                </div>

                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{service.name}</CardTitle>
                      <CardDescription className="mt-1">{service.description || "Standard event service"}</CardDescription>
                    </div>
                    <span className="rounded-2xl bg-amber-100 p-3 text-amber-800">
                      <Wrench className="h-5 w-5" />
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-2xl font-semibold">{formatCurrency(service.basePrice)}</p>
                      <p className="text-sm text-[var(--muted)]">
                        per {service.unitLabel} · {pricingModeSummary(service.pricingMode)}
                      </p>
                    </div>
                    <Badge>{service._count.bookingServices + service._count.packageServices} uses</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StockBadge categories={service.inventoryCategories} capacity={capacity} />
                    {service.inventoryCategories.length > 0 ? (
                      <span className="text-xs text-[var(--muted)]">
                        {service.inventoryCategories
                          .map((category) => {
                            const available = capacity[category]?.available ?? 0;
                            return `${available} ${formatInventoryCategory(category).toLowerCase()}`;
                          })
                          .join(" + ")}{" "}
                        free
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2">
                    <ServiceEditor
                      service={{
                        id: service.id,
                        name: service.name,
                        description: service.description,
                        basePrice: Number(service.basePrice),
                        unitLabel: service.unitLabel,
                        pricingMode: service.pricingMode,
                        inventoryCategories: service.inventoryCategories,
                        imageUrl: service.imageUrl,
                        imagePublicId: service.imagePublicId,
                      }}
                      categoryOptions={inventoryCategoryOptions()}
                      pricingOptions={pricingOptions}
                      capacity={capacity}
                    />
                    <ActionForm action={setServiceActiveFormAction}>
                      <input type="hidden" name="id" value={service.id} />
                      <input type="hidden" name="isActive" value={service.isActive ? "false" : "true"} />
                      <Button type="submit" size="sm" variant="outline">
                        {service.isActive ? <Archive className="mr-2 h-4 w-4" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
                        {service.isActive ? "Archive" : "Restore"}
                      </Button>
                    </ActionForm>
                    <ActionForm action={deleteServiceFormAction}>
                      <input type="hidden" name="id" value={service.id} />
                      <Button type="submit" size="sm" variant="destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </ActionForm>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card id="create-service">
        <CardHeader>
          <CardTitle>Add a service</CardTitle>
          <CardDescription>Services can be selected individually or bundled into packages.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createServiceFormAction} className="grid gap-5 lg:grid-cols-[1.2fr_1fr_0.7fr_0.8fr_auto] lg:items-end">
            <label className="grid gap-2 text-sm font-medium">
              Name
              <SuggestedInput list="service-name-suggestions" suggestions={SERVICE_NAME_SUGGESTIONS} name="name" placeholder="Start typing or choose a service" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Description
              <Input name="description" placeholder="Optional description" />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Base price
              <Input name="basePrice" type="number" min="1" step="0.01" placeholder="15000" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Unit label
              {/* A picker rather than a datalist: the browser's own suggestion
                  list only appears once there is something to type, so an admin
                  picking "per guest" from a blank field had nothing to choose
                  from. A unit outside the list is still accepted. */}
              <SearchableSelect
                name="unitLabel"
                options={UNIT_LABEL_OPTIONS}
                defaultValue="setup"
                allowCustomValue
                placeholder="Search or type a unit…"
                emptyLabel="Choose a unit"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Pricing mode
              <Select name="pricingMode" options={pricingOptions} defaultValue={PricingMode.FIXED} />
            </label>
            <SubmitButton>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </SubmitButton>
            <div className="lg:col-span-5">
              <InventoryCategoryField
                options={inventoryCategoryOptions()}
                capacity={capacity}
                hint="Links the service to stock categories — pick every one it consumes. One unit of the service draws one of each, and bookings that would exceed the available units are refused."
              />
            </div>
            <div className="lg:col-span-5">
              <ImageUploader folder="services" label="Service image" />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </main>
  );
}
