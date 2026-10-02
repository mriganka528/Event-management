"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { toast } from "react-hot-toast";
import type { ActionState } from "@/lib/actions";

export function ActionFeedback({ state }: { state?: ActionState }) {
  const lastState = useRef<ActionState | undefined>(undefined);

  useEffect(() => {
    if (lastState.current === state || (!state?.success && !state?.error)) return;
    lastState.current = state;

    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state.success) toast.success(state.success);
  }, [state]);

  if (!state?.success && !state?.error) return null;
  const isError = Boolean(state.error);
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {isError ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{isError ? state.error : state.success}</span>
    </div>
  );
}
