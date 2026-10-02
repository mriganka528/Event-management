"use client";

import { useActionState, useEffect, useRef, type FormHTMLAttributes } from "react";
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

  useEffect(() => {
    if (lastState.current === state || (!state.success && !state.error)) return;
    lastState.current = state;

    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <PendingFormContext.Provider value={isPending}>
      <form action={action} {...props}>
        {children}
      </form>
    </PendingFormContext.Provider>
  );
}
