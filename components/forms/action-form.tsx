"use client";

import { useActionState, useEffect, useRef, type FormHTMLAttributes } from "react";
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

  useEffect(() => {
    if (lastState.current === state || (!state.success && !state.error)) return;
    lastState.current = state;

    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state.success) {
      toast.success(state.success);
      // The action already called `revalidatePath`, but a client component
      // holding a `<select>` keeps its DOM state across the re-render, so a
      // stale control can mask the fresh server data. An explicit refresh
      // guarantees the table, status badge, and role selector all repaint from
      // the database rather than from whatever was last painted locally.
      router.refresh();
    }
  }, [state, router]);

  return (
    <PendingFormContext.Provider value={isPending}>
      <form action={action} {...props}>
        {children}
      </form>
    </PendingFormContext.Provider>
  );
}