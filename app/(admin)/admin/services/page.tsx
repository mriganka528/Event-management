import Image from "next/image";
import { Archive, ArchiveRestore, ImageIcon, Plus, Trash2, Wrench } from "lucide-react";
import { InventoryCategory, PricingMode } from "@prisma/client";
import { getAdminServices } from "@/lib/admin-data";
import {
  createServiceFormAction,
  deleteServiceFormAction,
  setServiceActiveFormAction,
  updateServiceFormAction,
} from "@/lib/form-actions";
import { ImageUploader } from "@/components/admin/image-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { formatCurrency } from "@/lib/utils";
import { ActionForm } from "@/components/forms/action-form";
import { SuggestedInput } from "@/components/ui/suggested-input";
import { SERVICE_NAME_SUGGESTIONS, UNIT_LABEL_SUGGESTIONS } from "@/lib/suggestions";

export const dynamic = "force-dynamic";

const pricingOptions = [
  { label: "Fixed price", value: PricingMode.FIXED },
  { label: "Per guest", value: PricingMode.PER_GUEST },
];
const inventoryOptions = [{ label: "No linked inventory", value: "" }, ...Object.values(InventoryCategory).map((category) => ({ label: category.charAt(0) + category.slice(1).toLowerCase().replaceAll("_", " "), value: category }))];

export default async function ServicesPage() {
  const services = await getAdminServices();
  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Service catalog</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Everything your team delivers.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Services power both custom quotes and package bundles. Upload service artwork to Cloudinary and archive retired services without breaking booking history.</p></div><a href="#create-service"><Button><Plus className="mr-2 h-4 w-4" />Add service</Button></a></section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{services.length === 0 ? <div className="md:col-span-2 xl:col-span-3"><EmptyState title="No services configured" description="Add the services your events can include." /></div> : services.map((service) => <Card key={service.id} className="overflow-hidden"><div className="relative aspect-[16/6] bg-[var(--surface)]">{service.imageUrl ? <Image src={service.imageUrl} alt={service.name} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" unoptimized className="object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted)]"><ImageIcon className="h-8 w-8" /></div>}{!service.isActive ? <Badge className="absolute left-4 top-4 bg-stone-900 text-white">Archived</Badge> : null}</div><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{service.name}</CardTitle><CardDescription className="mt-1">{service.description || "Standard event service"}</CardDescription></div><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><Wrench className="h-5 w-5" /></span></div></CardHeader><CardContent className="space-y-4"><div className="flex items-end justify-between gap-3"><div><p className="text-2xl font-semibold">{formatCurrency(service.basePrice)}</p><p className="text-sm text-[var(--muted)]">per {service.unitLabel} · {service.pricingMode === PricingMode.PER_GUEST ? "per guest" : "fixed"}</p></div><Badge>{service._count.bookingServices + service._count.packageServices} uses</Badge></div><div className="flex flex-wrap gap-2"><ActionForm action={setServiceActiveFormAction}><input type="hidden" name="id" value={service.id} /><input type="hidden" name="isActive" value={service.isActive ? "false" : "true"} /><Button type="submit" size="sm" variant="outline">{service.isActive ? <Archive className="mr-2 h-4 w-4" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}{service.isActive ? "Archive" : "Restore"}</Button></ActionForm><ActionForm action={deleteServiceFormAction}><input type="hidden" name="id" value={service.id} /><Button type="submit" size="sm" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</Button></ActionForm></div><details className="relative"><summary className="cursor-pointer list-none rounded-full border border-stone-200 px-3 py-2 text-center text-xs font-medium">Edit service</summary><div className="relative z-20 mt-2 w-full rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-xl lg:absolute lg:right-0 lg:w-96"><ActionForm action={updateServiceFormAction} className="grid gap-3"><input type="hidden" name="id" value={service.id} /><label className="grid gap-1 text-xs font-medium">Name<Input name="name" defaultValue={service.name} required /></label><label className="grid gap-1 text-xs font-medium">Description<Textarea name="description" defaultValue={service.description ?? ""} className="min-h-20" /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs font-medium">Price<Input name="basePrice" type="number" min="1" step="0.01" defaultValue={Number(service.basePrice)} required /></label><label className="grid gap-1 text-xs font-medium">Unit<Input name="unitLabel" defaultValue={service.unitLabel} required /></label></div><label className="grid gap-1 text-xs font-medium">Pricing mode<Select name="pricingMode" options={pricingOptions} defaultValue={service.pricingMode} /></label><label className="grid gap-1 text-xs font-medium">Inventory category<Select name="inventoryCategory" options={inventoryOptions} defaultValue={service.inventoryCategory ?? ""} /></label><ImageUploader folder="services" label="Service image" defaultUrl={service.imageUrl} defaultPublicId={service.imagePublicId} /><SubmitButton className="w-full">Save service</SubmitButton></ActionForm></div></details></CardContent></Card>)}</div>
      <Card id="create-service"><CardHeader><CardTitle>Add a service</CardTitle><CardDescription>Services can be selected individually or bundled into packages.</CardDescription></CardHeader><CardContent><ActionForm action={createServiceFormAction} className="grid gap-5 lg:grid-cols-[1.2fr_1fr_0.7fr_0.8fr_auto] lg:items-end"><label className="grid gap-2 text-sm font-medium">Name<SuggestedInput list="service-name-suggestions" suggestions={SERVICE_NAME_SUGGESTIONS} name="name" placeholder="Start typing or choose a service" required /></label><label className="grid gap-2 text-sm font-medium">Description<Input name="description" placeholder="Optional description" /></label><label className="grid gap-2 text-sm font-medium">Base price<Input name="basePrice" type="number" min="1" step="0.01" placeholder="15000" required /></label><label className="grid gap-2 text-sm font-medium">Unit label<SuggestedInput list="service-unit-suggestions" suggestions={UNIT_LABEL_SUGGESTIONS} name="unitLabel" defaultValue="setup" required /></label><label className="grid gap-2 text-sm font-medium">Pricing mode<Select name="pricingMode" options={pricingOptions} /></label><SubmitButton><Plus className="mr-2 h-4 w-4" />Add</SubmitButton><label className="grid gap-2 text-sm font-medium lg:col-span-5">Inventory category<Select name="inventoryCategory" options={inventoryOptions} /></label><div className="lg:col-span-5"><ImageUploader folder="services" label="Service image" /></div></ActionForm></CardContent></Card>
    </main>
  );
}
