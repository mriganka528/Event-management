"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { toast } from "react-hot-toast";
import type { AuthActionState } from "@/components/auth/action-state";

/**
 * Mirrors an auth action's outcome as a toast.
 *
 * The inline `AuthFeedback` banner is deliberately quiet: it is rendered inside
 * a card and is easy to miss when the browser scrolls, and a credential change
 * that appears to have done nothing is exactly the failure this page must not
 * have. Every outcome therefore also raises a toast, which stays on screen
 * regardless of scroll position:
 *
 *  - a rejected step is an error toast, naming the reason;
 *  - "a code has been sent" is an informational toast, not a success one,
 *    because nothing has actually changed yet;
 *  - a completed change is a success toast.
 *
 * `useActionState` produces a fresh object on every submission, so comparing by
 * identity fires exactly once per result and never on re-render.
 */
export function useAuthToast(state: AuthActionState) {
  const last = useRef<AuthActionState | null>(null);

  useEffect(() => {
    if (last.current === state) return;
    last.current = state;

    if (state.status === "error") {
      if (state.error) toast.error(state.error, { icon: <CircleAlert className="h-5 w-5" aria-hidden="true" /> });
      return;
    }
    if (state.status === "success" || state.status === "done") {
      if (state.message) toast.success(state.message, { icon: <CircleCheck className="h-5 w-5" aria-hidden="true" /> });
      return;
    }
    if ((state.status === "verify" || state.status === "activate") && state.message) {
      toast(state.message, { icon: <Info className="h-5 w-5" aria-hidden="true" /> });
    }
  }, [state]);
}