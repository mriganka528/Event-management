"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { announceNotification } from "@/components/notifications/announce";
import type { NotificationView } from "@/lib/notification-links";

/**
 * Live payment and booking alerts for the customer.
 *
 * The customer dashboard is where a customer checks whether their payment
 * landed. Waiting for a page refresh to find out is how a customer ends up
 * paying twice, so the customer's own notifications are announced the moment
 * they are created: the in-page popup, the chime, and the operating system's
 * notification.
 *
 * Server-Sent Events are the live path. The old Socket.IO connection only
 * existed in the custom server, so it could never connect on a serverless
 * deployment. The stream works in both places, carries the session cookie, and
 * reconnects automatically. A poll of the customer's own notification feed is
 * still kept as a fallback for browsers or networks where the stream is
 * blocked. Either way the arrival is announced exactly once, because the ids
 * already seen are remembered.
 *
 * `initialItems` are the notifications the page was rendered with. They are
 * what has already happened, so they are recorded as seen and never
 * announced: a chime for something that occurred before the reader arrived
 * is a greeting for the wrong moment.
 */
export function CustomerNotificationListener({ initialItems }: { initialItems: NotificationView[] }) {
  const router = useRouter();
  // The ids already seen, so a notification is only ever announced once.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) {
    seen.current = new Set(initialItems.map((item) => item.id));
  }

  useEffect(() => {
    let disposed = false;
    let live = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function announce(item: NotificationView) {
      const known = seen.current ?? new Set<string>();
      seen.current = known;
      if (known.has(item.id)) return;
      known.add(item.id);
      announceNotification(item, { navigate: (href) => router.push(href) });
    }

    /*
     * One read of the customer's own feed.
     *
     * Used two ways: as the fallback when there is no stream, and as a
     * catch-up right after the stream opens, because a notification created
     * during the handshake may not have been in the first snapshot.
     */
    async function catchUp() {
      try {
        const response = await fetch("/api/customer/notifications", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { items?: NotificationView[] };
        if (disposed || !Array.isArray(payload.items)) return;
        for (const item of payload.items) announce(item);
      } catch {
        // A failed read is not worth an error popup; the next tick tries again.
      }
    }

    function connect() {
      if (disposed) return;
      if (typeof EventSource === "undefined") return;

      source = new EventSource("/api/realtime");

      source.onopen = () => {
        live = true;
        // The handshake took a moment, so anything created during it may not
        // have been in the first snapshot. This closes that gap.
        void catchUp();
      };

      source.addEventListener("notifications", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { items?: NotificationView[] };
          if (!Array.isArray(payload.items)) return;
          for (const item of payload.items) announce(item);
        } catch {
          // A malformed frame is not worth an error popup; the polling
          // fallback and the next snapshot still deliver the list.
        }
      });

      source.onerror = () => {
        live = false;
        if (disposed || !source) return;

        if (source.readyState === EventSource.CLOSED) {
          // A refused handshake or an unsupported endpoint closes for good.
          // Keep polling and try the stream again later.
          source.close();
          source = null;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 30_000);
        }
      };
    }

    connect();

    /*
     * The fallback for a deployment or network where the stream cannot stay
     * open. It asks for the customer's own notifications rather than
     * re-rendering the page, so a payment confirmation still reaches them in
     * seconds.
     */
    const timer = window.setInterval(async () => {
      if (disposed || live) return;
      await catchUp();
    }, 10_000);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.clearInterval(timer);
      source?.close();
    };
  }, [router]);

  return null;
}
