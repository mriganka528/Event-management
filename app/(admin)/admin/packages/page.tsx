import Image from "next/image";
import type { Metadata } from "next";
import { Archive, ArchiveRestore, ImageIcon, Plus, ShoppingBag, Trash2, Users } from "lucide-react";
import { getAdminPackages, getAdminServices } from "@/lib/admin-data";
import {
  createPackageFormAction,
  deletePackageFormAction,
  setPackageActiveFormAction,
} from "@/lib/form-actions";
import { AdminSearch } from "@/components/admin/admin-search";
import { PackageEditor } from "@/components/admin/package-editor";
import { ImageUploader } from "@/components/admin/image-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { formatCurrency } from "@/lib/utils";
import { ActionForm } from "@/components/forms/action-form";
import { SuggestedInput } from "@/components/ui/suggested-input";
import { PACKAGE_NAME_SUGGESTIONS } from "@/lib/suggestions";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Packages",
  description: "Bundle services into customer-facing packages and keep the public catalog in sync.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const [packages, services] = await Promise.all([getAdminPackages(), getAdminServices()]);
  // Rows stay in the DOM; non-matching ones are hidden so the browser can
  // reveal them again without a request.
  const visibility = rowFilter(query);

  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search packages"
        placeholder="Search by package name, description, or included service…"
      />
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Package catalog</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Make planning simpler.</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">Create ready-made experiences that customers can select while booking. Upload package artwork to Cloudinary and keep the public catalog in sync automatically.</p>
        </div>
        <a href="#create-package"><Button><Plus className="mr-2 h-4 w-4" />Create package</Button></a>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {packages.length === 0 ? (
          <div className="lg:col-span-2">
            <EmptyState title="No packages yet" description="Create a package to give customers a strong starting point." />
          </div>
        ) : packages.map((item) => {
          const searchText = rowText(item.name, item.slug, item.description, ...item.packageServices.map((entry) => entry.service.name));
          return (
          <Card
            key={item.id}
            data-row-id={item.id}
            data-row-text={searchText}
            style={visibility(searchText)}
            className="overflow-hidden"
          >
            <div className="relative aspect-[16/7] bg-[var(--surface)]">
              {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill sizes="(min-width: 1024px) 50vw, 100vw" unoptimized className="object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted)]"><ImageIcon className="h-10 w-10" /></div>}
              {!item.isActive ? <Badge className="absolute left-4 top-4 bg-stone-900 text-white">Archived</Badge> : null}
            </div>
            <CardHeader className="border-b border-stone-100">
              <div className="flex items-start justify-between gap-4">
                <div><Badge className="bg-amber-100 text-amber-900">{item.packageServices.length} services</Badge><CardTitle className="mt-3 text-2xl">{item.name}</CardTitle><CardDescription className="mt-2">{item.description}</CardDescription></div>
                <p className="shrink-0 text-2xl font-semibold text-amber-800">{formatCurrency(item.price)}</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-2">{item.packageServices.map((entry) => <Badge key={entry.serviceId}>{entry.service.name}</Badge>)}</div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><Users className="h-4 w-4" />{item._count.bookings} bookings</span><div className="flex flex-wrap gap-2">
                <ActionForm action={setPackageActiveFormAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="isActive" value={item.isActive ? "false" : "true"} /><Button type="submit" size="sm" variant="outline">{item.isActive ? <Archive className="mr-2 h-4 w-4" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}{item.isActive ? "Archive" : "Restore"}</Button></ActionForm>
                <ActionForm action={deletePackageFormAction}><input type="hidden" name="id" value={item.id} /><Button type="submit" size="sm" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</Button></ActionForm>
              </div></div>
              <PackageEditor
                item={{
                  id: item.id,
                  name: item.name,
                  description: item.description,
                  price: Number(item.price),
                  imageUrl: item.imageUrl,
                  imagePublicId: item.imagePublicId,
                  packageServices: item.packageServices.map((entry) => ({ serviceId: entry.serviceId })),
                }}
                services={services.map((service) => ({ id: service.id, name: service.name, isActive: service.isActive }))}
              />
            </CardContent>
          </Card>
          );
        })}
      </div>

      <Card id="create-package"><CardHeader><CardTitle>Create a package</CardTitle><CardDescription>Bundle services into a customer-facing starting price.</CardDescription></CardHeader><CardContent><ActionForm action={createPackageFormAction} className="grid gap-5 lg:grid-cols-[1fr_1fr_0.6fr]"><div className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Package name<SuggestedInput list="package-name-suggestions" suggestions={PACKAGE_NAME_SUGGESTIONS} name="name" placeholder="Start typing or choose a package" required /></label><label className="grid gap-2 text-sm font-medium">Description<Textarea name="description" placeholder="Describe the experience and what is included." required /></label><ImageUploader folder="packages" label="Package image" /></div><fieldset className="grid content-start gap-3 rounded-2xl bg-stone-50 p-4"><legend className="px-1 text-sm font-semibold">Included services</legend>{services.filter((service) => service.isActive).length === 0 ? <p className="text-sm text-[var(--muted)]">Add an active service first.</p> : services.filter((service) => service.isActive).map((service) => <label key={service.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="serviceIds" value={service.id} />{service.name} <span className="ml-auto text-xs text-[var(--muted)]">{formatCurrency(service.basePrice)}</span></label>)}</fieldset><div className="grid content-start gap-4"><label className="grid gap-2 text-sm font-medium">Starting price<Input name="price" type="number" min="1" step="0.01" placeholder="45000" required /></label><SubmitButton className="w-full"><ShoppingBag className="mr-2 h-4 w-4" />Create package</SubmitButton></div></ActionForm></CardContent></Card>
    </main>
  );
}
