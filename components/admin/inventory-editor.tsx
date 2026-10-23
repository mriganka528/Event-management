"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { updateInventoryFormAction } from "@/lib/form-actions";
import type { ActionState } from "@/lib/actions";
import { ImageUploader } from "@/components/admin/image-uploader";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";

const initialState: ActionState = { success: null, error: null };

type EditableItem = {
  id: string;
  name: string;
  slug: string;
  category: string;
  totalQuantity: number;
  bookedQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  imageUrl: string | null;
  imagePublicId: string | null;
  isActive: boolean;
};

/**
 * Edit trigger for one stock row.
 *
 * This replaces an inline `<details>` panel that was positioned absolutely
 * inside a table cell. Three things were wrong with it at once: the card and the
 * table both set `overflow`, so the panel was clipped and appeared to open
 * underneath the row; a fixed `w-96` had no small-screen behaviour, so the form
 * did not reflow on a phone; and `bg-white` pinned it to the light palette while
 * the rest of the panel used theme tokens.
 *
 * A fixed overlay cannot be clipped by a table, cannot be pushed behind a
 * sibling row, and remounts on every open so the fields always show the stored
 * values rather than the last edit.
 */
export function InventoryEditor({
  item,
  categoryOptions,
}: {
  item: EditableItem;
  categoryOptions: readonly { label: string; value: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit
      </Button>
      {open ? <InventoryEditDialog item={item} categoryOptions={categoryOptions} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InventoryEditDialog({
  item,
  categoryOptions,
  onClose,
}: {
  item: EditableItem;
  categoryOptions: readonly { label: string; value: string }[];
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
    async (_previousState: ActionState, formData: FormData) => updateInventoryFormAction(formData),
    initialState,
  );
  const router = useRouter();
  /*
   * The dialog is unmounted when it closes and remounted when it opens, so
   * `dirty` starting at `false` is exactly "nothing has been touched yet".
   *
   * Comparing each field against `defaultValue` was the obvious alternative and
   * it cannot work here: a `<select>`'s `defaultValue` follows its selectedness,
   * so the category control would always read as unchanged. Tracking the event
   * instead is simpler and has no such blind spot.
   */
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    // Stop the page behind the dialog scrolling while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
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
      // the table from the database instead of from the last client render.
      router.refresh();
    }
  }, [state, onClose, router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${item.name}`}
    >
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="Close the editor" onClick={onClose} />
      <div className="relative my-auto w-full max-w-xl rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-2xl font-semibold">Edit stock item</h3>
            <p className="mt-1 break-words text-sm text-[var(--muted)]">{item.name}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Close the editor" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/*
          Single column on a phone, two from `sm` up. The old panel was a fixed
          `w-96` grid, so the quantity pair stayed two-across on a 360px screen
          and the inputs were squeezed to unusable widths.
        */}
        <form action={formAction} className="grid gap-4" onChange={markDirty} onInput={markDirty}>
          <input type="hidden" name="id" value={item.id} />

          <label className="grid gap-2 text-sm font-medium">
            Name <span className="text-red-600">*</span>
            <Input name="name" defaultValue={item.name} required className="w-full" />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Category
            {/* Searchable, and pre-set: the stored category is what the dialog
                opened with, and Save stays disabled until `onValueChange` says
                something actually changed. */}
            <SearchableSelect name="category" options={categoryOptions} defaultValue={item.category} onValueChange={markDirty} placeholder="Search categories…" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              Total quantity <span className="text-red-600">*</span>
              {/* A booking may already have reserved units; the server refuses a
                  total below them and this makes that visible before saving. */}
              <Input name="totalQuantity" type="number" min={item.bookedQuantity} defaultValue={item.totalQuantity} required className="w-full" />
              <span className="text-xs font-normal text-[var(--muted)]">{item.bookedQuantity} already reserved</span>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Reorder level <span className="text-red-600">*</span>
              <Input name="reorderLevel" type="number" min="0" defaultValue={item.reorderLevel} required className="w-full" />
              <span className="text-xs font-normal text-[var(--muted)]">Warn at or below this</span>
            </label>
          </div>

          <div className="rounded-2xl bg-[var(--surface-muted)] p-3 text-sm">
            <p className="text-[var(--muted)]">
              {item.availableQuantity} available · {item.bookedQuantity} booked · {item.totalQuantity} total
            </p>
          </div>

          <ImageUploader folder="inventory" label="Inventory image" defaultUrl={item.imageUrl} defaultPublicId={item.imagePublicId} onValueChange={markDirty} />

          <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--line)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {/* Disabled until a field actually differs from the stored record,
                so a pointless save cannot be sent and a successful one is
                unmistakably a change the operator made. */}
            <SubmitButton disabled={!dirty}>Save item</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
