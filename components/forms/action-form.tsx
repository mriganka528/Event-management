"use client";

import { useActionState, useEffect, useRef, useState, type FormHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { PendingFormContext } from "@/components/forms/pending-form-context";
import type { ActionState } from "@/lib/actions";

const initialState: ActionState = { success: null, error: null };

type FormAction = (formData: FormData) => Promise<ActionState>;

type ActionFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: FormAction;
};

export function ActionForm({ action: serverAction, children, ...props }: ActionFormProps) {
  const [state, action, isPending] = useActionState(
    async (_previousState: ActionState, formData: FormData) => serverAction(formData),
    initialState,
  );
  const lastState = useRef<ActionState | null>(null);
  const router = useRouter();
  // Bumped after a successful save to remount the form and everything inside it.
  const [formKey, setFormKey] = useState(0);
  const [seenState, setSeenState] = useState<ActionState | null>(null);

  // Remounting is what stops a *create* form carrying its previous entry
  // forward. The uploaded image in particular is `useState` inside
  // `ImageUploader`, seeded once from `defaultUrl`, so after saving a new item
  // the "Add …" panel kept showing the picture that had just been attached to
  // the item above it — ready to be saved onto the next one. Uncontrolled inputs
  // reset for the same reason.
  //
  // It happens during render rather than in the effect below. This is React's
  // sanctioned "adjust state when something changes" pattern: it re-runs this
  // component immediately with the new state and commits the remount in the same
  // paint. Doing it in an effect would be a synchronous setState inside the
  // effect body, cascading a second render purely to reach a value that was
  // already known.
  if (state !== seenState) {
    setSeenState(state);
    if (state.success) setFormKey((key) => key + 1);
  }

  useEffect(() => {
    if (lastState.current === state || (!state.success && !state.error)) return;
    lastState.current = state;

    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state.success) {
      toast.success(state.success);
      // `revalidatePath` already runs server-side; a client component holding a
      // `<select>` or a file field keeps its DOM state across the re-render, so a
      // stale control can mask the fresh server data. An explicit refresh
      // guarantees the table, status badge, and role selector all repaint from
      // the database rather than from whatever was last painted locally.
      router.refresh();
    }
  }, [state, router]);

  return (
    <PendingFormContext.Provider value={isPending}>
      <form key={formKey} action={action} {...props}>
        {children}
      </form>
    </PendingFormContext.Provider>
  );
}