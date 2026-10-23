import { NotificationAudience, RoleKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accessDenied, isAdminRole, requireApiUser } from "@/lib/route-guards";
import { toNotificationView } from "@/lib/notification-links";

/**
 * The live notification stream.
 *
 * The custom server in `server.mjs` uses Socket.IO, which works locally but is
 * not part of a Vercel deployment: Vercel runs the Next.js request handlers, not
 * the standalone HTTP server. The browser therefore sat on "Offline" forever
 * even though the polling fallback was still fetching notifications.
 *
 * Server-Sent Events are a better fit for this one-way feed and work both in
 * local development and on Vercel. A connection is held open until the
 * function's maximum duration, the browser reconnects automatically, and each
 * reconnection re-authenticates against the session cookie. The stream watches
 * the signed-in user's own notification rows, so it also works across serverless
 * instances without a shared in-memory event bus or Redis.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel closes a streaming function at its maximum duration. The browser's
// EventSource reconnects, and the next connection starts with a fresh snapshot.
export const maxDuration = 300;

const POLL_INTERVAL_MS = 4_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

function eventStreamHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    // Prevent reverse proxies from buffering the stream until the function ends.
    "X-Accel-Buffering": "no",
  };
}

export async function GET(request: Request) {
  let user;
  try {
    user = await requireApiUser();
  } catch (error) {
    return accessDenied(error);
  }

  const audience =
    user.role === RoleKey.CUSTOMER
      ? NotificationAudience.CUSTOMER
      : isAdminRole(user.role)
        ? NotificationAudience.ADMIN
        : null;

  // Staff do not have a notification audience in this application. Returning
  // an empty stream would keep a useless connection open in every staff tab.
  if (!audience) {
    return Response.json(
      { error: "Live notifications are not available for this account." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const audienceLabel = audience === NotificationAudience.CUSTOMER ? "CUSTOMER" : "ADMIN";

  const encoder = new TextEncoder();
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream; the failure is the
          // same either way and must not escape into the server logs.
        }
      };
      cleanup = close;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };

      let signature = "";
      let inFlight = false;

      const poll = async () => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          const notifications = await prisma.notification.findMany({
            where: { userId: user.id, audience },
            orderBy: { createdAt: "desc" },
            take: 20,
          });
          const items = notifications.map((notification) => toNotificationView(notification, audienceLabel));
          const unread = items.filter((item) => !item.read).length;
          const nextSignature = JSON.stringify({ items, unread });

          // Only wake the client when something actually changed. The stream is
          // also the catch-up path after a reconnect, so the first snapshot is
          // always sent, even when the inbox is empty.
          if (nextSignature === signature) return;
          signature = nextSignature;
          send("notifications", { items, unread });
        } catch (error) {
          // A transient database error should not tear down the connection. The
          // next poll retries, and the browser's polling fallback covers a longer
          // outage.
          console.error("[realtime] notification poll failed:", error instanceof Error ? error.message : error);
        } finally {
          inFlight = false;
        }
      };

      request.signal.addEventListener("abort", close, { once: true });

      // Flush the response headers and establish EventSource's open event before
      // the first database round trip.
      send("ready", { connectedAt: new Date().toISOString() });
      void poll();

      pollTimer = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: eventStreamHeaders() });
}
