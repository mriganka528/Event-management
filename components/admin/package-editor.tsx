"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { updatePackageFormAction } from "@/lib/form-actions";
import type { ActionState } from "@/lib/actions";
import { ImageUploader } from "@/components/admin/image-uploader";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const initialState: ActionState = { success: null, error: null };

type EditablePackage = {
  id: string;
  name: string;
  description: string;
  price: number | string;
  imageUrl: string | null;
  imagePublicId: string | null;
  packageServices: { serviceId: string }[];
};

/** Only active services can be selected; an archived one cannot be bundled. */
type ServiceOption = { id: string; name: string; isActive: boolean };

/**
 * Edit trigger for one package card.
 *
 * This replaces an inline `<details>` panel. Two reasons it could not simply
 * stay: a panel positioned absolutely inside a card that clips its own overflow
 * is cut off, and the save button it needed to honour — disabled until the form
 * genuinely changed — requires holding state, which a server component cannot do.
 * Owning the dialog outright solves both and matches the service and stock
 * editors.
 */
export function PackageEditor({
  item,
  services,
}: {
  item: EditablePackage;
  services: readonly ServiceOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit package
      </Button>
      {open ? <PackageEditDialog item={item} services={services} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PackageEditDialog({
  item,
  services,
  onClose,
}: {
  item: EditablePackage;
  services: readonly ServiceOption[];
  onClose: () => void;
}) {
  /*
   * `useActionState` always invokes its action as `(previousState, formData)`.
   * Passing the server action straight in handed it the previous state where the
   * form data belonged, and the first call inside it — `formData.get("id")` —
   * failed with "formData.get is not a function".
   */
  const [state, formAction] = useActionState(
    async (_previousState: ActionState, formData: FormData) => updatePackageFormAction(formData),
    initialState,
  );
  const router = useRouter();
  // Remounted on every open, so `false` here means "nothing has been touched yet".
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
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
      router.refresh();
    }
  }, [state, onClose, router]);

  const available = services.filter((service) => service.isActive);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${item.name}`}
    >
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="Close the editor" onClick={onClose} />
      <div className="relative my-auto w-full max-w-2xl rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-2xl font-semibold">Edit package</h3>
            <p className="mt-1 break-words text-sm text-[var(--muted)]">{item.name}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Close the editor" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <form action={formAction} className="grid gap-4" onChange={markDirty} onInput={markDirty}>
          <input type="hidden" name="id" value={item.id} />

          <label className="grid gap-2 text-sm font-medium">
            Name <span className="text-red-600">*</span>
            <Input name="name" defaultValue={item.name} required />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Description <span className="text-red-600">*</span>
            <Textarea name="description" defaultValue={item.description} className="min-h-24" required />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Price <span className="text-red-600">*</span>
            <Input name="price" type="number" min="1" step="0.01" defaultValue={Number(item.price)} required />
          </label>

          <ImageUploader folder="packages" label="Package image" defaultUrl={item.imageUrl} defaultPublicId={item.imagePublicId} onValueChange={markDirty} />

          <fieldset className="grid gap-2 rounded-2xl bg-[var(--surface-muted)] p-4">
            <legend className="px-1 text-sm font-semibold">Included services</legend>
            {available.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Add an active service first.</p>
            ) : (
              available.map((service) => (
                <label key={service.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="serviceIds" value={service.id} defaultChecked={item.packageServices.some((entry) => entry.serviceId === service.id)} />
                  {service.name}
                </label>
              ))
            )}
          </fieldset>

          <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--line)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton disabled={!dirty}>Save package</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
