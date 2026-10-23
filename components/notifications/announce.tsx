"use client";

import { BellRing, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { playNotificationSound } from "@/lib/notification-sound";
import type { NotificationView } from "@/lib/notification-links";

/**
 * How a notification reaches a reader.
 *
 * Three channels, on purpose:
 *
 *  - the in-page popup, for the tab that is in front of the reader;
 *  - the operating system's notification, for a reader in another tab or on
 *    another device;
 *  - the chime, for a reader whose tab is in the background and who would
 *    otherwise see nothing at all.
 *
 * A payment alert that only appeared in the bell would be read whenever the
 * reader happened to look, which is not what a payment alert is for.
 */
export function announceNotification(item: NotificationView, options: { navigate?: (href: string) => void } = {}) {
  playNotificationSound();
  showBrowserNotification(item, options.navigate);
  showInAppPopup(item);
}

/**
 * The operating system's notification.
 *
 * The browser only allows this once the reader has granted permission, and it
 * is skipped when they have turned it off. Neither is an error: the in-page
 * popup and the chime are still raised.
 */
export function showBrowserNotification(item: NotificationView, navigate?: (href: string) => void) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;
  try {
    if (localStorage.getItem(BROWSER_KEY) === "off") return;
  } catch {
    // A browser that refuses local storage still gets the alert.
  }
  try {
    const notification = new window.Notification(item.title, {
      body: item.message,
      tag: item.id,
      icon: "/icon.svg",
    });
    notification.onclick = () => {
      window.focus();
      if (navigate && item.href) navigate(item.href);
      notification.close();
    };
  } catch {
    // Some browsers block constructing notifications outside a user gesture.
  }
}

/**
 * The in-page popup.
 *
 * `toast.custom` renders this markup as-is and, unlike `toast.success` and
 * `toast.error`, ignores `toastOptions.style` entirely. The styling in
 * `AppToaster` therefore never reaches it, so every visual property is
 * restated here.
 *
 * The close button is explicit because a custom toast has no built-in
 * dismiss control, and the reader is the one who decides they have read it.
 */
export function showInAppPopup(item: NotificationView) {
  toast.custom(
    (toastItem) => (
      <div
        role="status"
        className="flex w-full items-start gap-3 rounded-2xl border border-[var(--line-strong)] bg-[var(--card-elevated)] p-4 text-left text-[var(--foreground)] shadow-[0_18px_48px_rgba(53,41,26,0.18)]"
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <BellRing className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="pr-1 text-sm font-semibold">{item.title}</span>
          <span className="mt-1 break-words text-xs font-normal leading-5 text-[var(--muted)]">{item.message}</span>
        </span>
        <button
          type="button"
          onClick={() => toast.dismiss(toastItem.id)}
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          aria-label="Dismiss notification"
          title="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    ),
    { icon: null, duration: 6000 },
  );
}

const BROWSER_KEY = "staff-browser-notifications";
