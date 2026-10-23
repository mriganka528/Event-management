"use client";

import { ToastBar, Toaster, toast } from "react-hot-toast";
import { X } from "lucide-react";

/**
 * The shared toaster.
 *
 * Every popup is rendered here with its own close button, so a reader can
 * dismiss a message instead of waiting for it to time out. The button lives
 * inside the toast card rather than floating over it, which keeps the
 * dismissal control in the same place every time it appears.
 *
 * `toast.custom` popups do not come through here: react-hot-toast renders
 * those verbatim, so the realtime notification popup carries its own close
 * button.
 */
export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      gutter={10}
      toastOptions={{
        duration: 3500,
        className: "app-toast",
        success: {
          iconTheme: { primary: "#16803c", secondary: "#ffffff" },
        },
        error: {
          iconTheme: { primary: "#b42318", secondary: "#ffffff" },
          duration: 5000,
        },
        style: {
          background: "var(--card-elevated)",
          color: "var(--foreground)",
          border: "1px solid var(--line-strong)",
          borderRadius: "16px",
          boxShadow: "0 18px 48px rgba(53, 41, 26, 0.18)",
          fontSize: "0.875rem",
          fontWeight: 600,
          padding: "12px 16px",
        },
      }}
    >
      {(item) => (
        <ToastBar toast={item}>
          {({ icon, message }) => (
            <div role="status" aria-live="polite" className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">{icon}</span>
              <span className="min-w-0 flex-1 whitespace-pre-line">{message}</span>
              <button
                type="button"
                onClick={() => toast.dismiss(item.id)}
                className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                aria-label="Close notification"
                title="Close notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
