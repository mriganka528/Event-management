"use client";

import { createContext, useContext } from "react";

/**
 * Exposes whether the surrounding action form is currently running a server
 * action so any submit <Button> inside it can disable itself and show a spinner
 * without every form having to opt in.
 */
export const PendingFormContext = createContext(false);

export function usePendingForm() {
  return useContext(PendingFormContext);
}
