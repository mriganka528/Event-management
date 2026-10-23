"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { updateServiceFormAction } from "@/lib/form-actions";
import type { ActionState } from "@/lib/actions";
import { InventoryCategoryField } from "@/components/admin/inventory-category-field";
import { ImageUploader } from "@/components/admin/image-uploader";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UNIT_LABEL_OPTIONS } from "@/lib/suggestions";
import type { CapacityView } from "@/lib/inventory";

const initialState: ActionState = { success: null, error: null };

type EditableService = {
  id: string;
  name: string;
  description: string | null;
  basePrice: string | number;
  unitLabel: string;
  pricingMode: string;
  inventoryCategories: string[];
  imageUrl: string | null;
  imagePublicId: string | null;
};

/**
 * Edit trigger for one service card.
 *
 * The editor is a real dialog rather than an inline `<details>` popover: the
 * card clips its own overflow, so an absolutely positioned panel inside it was
 * cut off and the form never became reachable. A fixed overlay cannot be
 * clipped by a card, cannot be pushed behind a sibling card, and remounts on
 * every open so the fields always show the stored values rather than the last
 * edit.
 */
export function ServiceEditor({
  service,
  categoryOptions,
  pricingOptions,
  capacity,
}: {
  service: EditableService;
  categoryOptions: readonly { label: string; value: string }[];
  pricingOptions: readonly { label: string; value: string }[];
  capacity: Record<string, CapacityView>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit service
      </Button>
      {open ? (
        <ServiceEditDialog
          service={service}
          categoryOptions={categoryOptions}
          pricingOptions={pricingOptions}
          capacity={capacity}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ServiceEditDialog({
  service,
  categoryOptions,
  pricingOptions,
  capacity,
  onClose,
}: {
  service: EditableService;
  categoryOptions: readonly { label: string; value: string }[];
  pricingOptions: readonly { label: string; value: string }[];
  capacity: Record<string, CapacityView>;
  onClose: () => void;
}) {
  /*
   * `useActionState` always invokes its action as `(previousState, formData)`.
   * Passing the server action straight in therefore handed it the previous state
   * where the form data belonged, and the first call inside it —
   * `formData.get("id")` — failed with "formData.get is not a function".
   * `ActionForm` wraps it for exactly this reason; the wrapper here is the same
   * one line.
   */
  const [state, formAction] = useActionState(
    async (_previousState: ActionState, formData: FormData) => updateServiceFormAction(formData),
    initialState,
  );
  const router = useRouter();
  // See the note in `inventory-editor.tsx`: the dialog remounts on every open,
  // so `false` here means "nothing has been touched yet".
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state.success) {
      toast.success(state.success);
      onClose();
      // `revalidatePath` already runs server-side; the explicit refresh repaints
      // the cards from the database instead of from the last client render.
      router.refresh();
    }
  }, [state, onClose, router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${service.name}`}
    >
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="Close the editor" onClick={onClose} />
      <div className="relative my-auto w-full max-w-2xl rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold">Edit service</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">Changes apply to new quotes immediately. Existing bookings keep their price.</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Close the editor" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <form action={formAction} className="grid gap-4" onChange={markDirty} onInput={markDirty}>
          <input type="hidden" name="id" value={service.id} />

          <label className="grid gap-2 text-sm font-medium">
            Name <span className="text-red-600">*</span>
            <Input name="name" defaultValue={service.name} required />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Description <span className="text-sm font-normal text-[var(--muted)]">(optional)</span>
            <Textarea name="description" defaultValue={service.description ?? ""} className="min-h-20" />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">
              Base price <span className="text-red-600">*</span>
              <Input name="basePrice" type="number" min="1" step="0.01" defaultValue={Number(service.basePrice)} required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Unit label <span className="text-red-600">*</span>
              {/*
                This field was a plain text input, so the only thing on screen was
                the value already stored — one suggestion, and not one that was
                ever offered. It gets the same picker as the add form, pre-set to
                the service's own unit, and a unit outside the list is still
                accepted for a service that is quoted some other way.
              */}
              <SearchableSelect
                name="unitLabel"
                options={UNIT_LABEL_OPTIONS}
                defaultValue={service.unitLabel}
                allowCustomValue
                onValueChange={markDirty}
                placeholder="Search or type a unit…"
                emptyLabel="Choose a unit"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Pricing mode
              <Select name="pricingMode" options={pricingOptions} defaultValue={service.pricingMode} />
            </label>
          </div>

          <InventoryCategoryField
            options={categoryOptions}
            capacity={capacity}
            defaultValues={service.inventoryCategories}
            hint="Links this service to stock categories so bookings cannot oversubscribe them. One unit of the service draws one of each."
            onValuesChange={markDirty}
          />

          <ImageUploader
            folder="services"
            label="Service image"
            defaultUrl={service.imageUrl}
            defaultPublicId={service.imagePublicId}
            onValueChange={markDirty}
          />

          <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--line)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {/* Disabled until a field actually differs from the stored record,
                so a pointless save cannot be sent and a successful one is
                unmistakably a change the operator made. */}
            <SubmitButton disabled={!dirty}>Save changes</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
