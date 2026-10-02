"use client";

import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { IDLE_AUTH_STATE, isAwaitingCode, nextRoute, type AuthActionState } from "@/components/auth/action-state";

/**
 * Shared result type for the first-party auth server actions, plus the rules for
 * reacting to one. Both live in `action-state.ts` so they can be unit-tested
 * without pulling in a component, and so every form follows the same hand-off
 * contract. Re-exported here because that is where forms already import them.
 */
export { IDLE_AUTH_STATE, nextRoute, isAwaitingCode, type AuthActionState };

const TONE = {
  error: {
    box: "border-[color:color-mix(in_srgb,var(--danger-text)_28%,transparent)] bg-[var(--danger-soft)] text-[var(--danger-text)]",
    Icon: CircleAlert,
  },
  success: {
    box: "border-[color:color-mix(in_srgb,var(--success-text)_28%,transparent)] bg-[var(--success-soft)] text-[var(--success-text)]",
    Icon: CircleCheck,
  },
  info: {
    box: "border-[color:color-mix(in_srgb,var(--info-text)_28%,transparent)] bg-[var(--info-soft)] text-[var(--info-text)]",
    Icon: Info,
  },
} as const;

export function AuthFeedback({ state, tone = "auto" }: { state: AuthActionState; tone?: keyof typeof TONE | "auto" }) {
  if (!state.error && !state.message) return null;
  const resolved = tone === "auto" ? (state.status === "error" ? "error" : state.status === "success" ? "success" : "info") : tone;
  const style = TONE[resolved];
  const Icon = style.Icon;
  const text = state.error ?? state.message ?? "";

  return (
    <div role={resolved === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${style.box}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
