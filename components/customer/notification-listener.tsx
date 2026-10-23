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
 * The socket is the fast path. A serverless deployment has none, so a poll of
 * the customer's own notification feed covers that case. Either way the
 * arrival is announced exactly once, because the ids already seen are
 * remembered.
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
    let socket: import("socket.io-client").Socket | null = null;
    let live = false;

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
     * Used two ways: as the fallback when there is no socket, and as a
     * catch-up right after the socket connects, because a notification created
     * during the handshake was never pushed to a socket that did not exist
     * yet.
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

    async function connect() {
      const { io } = await import("socket.io-client");
      if (disposed) return;
      socket = io({
        path: "/api/socket.io",
        withCredentials: true,
        transports: ["websocket", "polling"],
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        timeout: 8000,
      });
      socket.on("connect", () => {
        live = true;
        // The handshake took a moment, so anything created during it was
        // never pushed. This closes that gap.
        void catchUp();
      });
      socket.on("disconnect", () => {
        live = false;
      });
      socket.on("realtime:event", (event: { type?: string; notification?: NotificationView }) => {
        const incoming = event?.notification;
        if (incoming) announce(incoming);
      });
    }

    void connect();

    /*
     * The fallback for a deployment with no socket server. It asks for the
     * customer's own notifications rather than re-rendering the page, so a
     * payment confirmation reaches them in seconds.
     */
    const timer = window.setInterval(async () => {
      if (disposed || live) return;
      await catchUp();
    }, 10_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      socket?.disconnect();
    };
  }, [router]);

  return null;
}
