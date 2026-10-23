"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCheck, Radio, Settings2, Volume2, VolumeX, WifiOff, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { markAllNotificationsFormAction, markNotificationsSeenAction } from "@/lib/form-actions";
import { isNotificationSoundEnabled, playNotificationSound, setNotificationSoundEnabled, unlockNotificationSound } from "@/lib/notification-sound";
import { announceNotification } from "@/components/notifications/announce";
import { cn } from "@/lib/utils";
import type { NotificationView } from "@/lib/notification-links";

const BROWSER_KEY = "staff-browser-notifications";

/**
 * The live-connection indicator, as three distinct states rather than a boolean.
 *
 * A boolean collapses "still trying" and "refused" into one word, and the previous
 * version printed "Connecting" for both. A handshake the server rejects never
 * resolves, so a broken connection looked permanently in progress instead of
 * looking broken, and there was nothing on screen to act on.
 */
type LiveState = {
  status: "connecting" | "live" | "offline";
  /** Why it is not live, when the server or the network said so. */
  reason?: string;
};

const LIVE_LABEL: Record<LiveState["status"], string> = {
  connecting: "Connecting",
  live: "Live",
  offline: "Offline",
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Whether a notification's link points at the page being viewed.
 *
 * The comparison is on the path, not the whole link: a notification that
 * points at `/admin/bookings?status=PENDING` is about the bookings page, so
 * opening `/admin/bookings` has dealt with it. A deeper page counts too, so
 * `/admin/bookings/abc` satisfies a link to `/admin/bookings`.
 */
function isSameDestination(href: string, pathname: string) {
  const target = href.split(/[?#]/)[0]?.replace(/\/+$/, "");
  const current = pathname.replace(/\/+$/, "");
  if (!target) return false;
  return current === target || current.startsWith(`${target}/`);
}

export function AdminNotificationCenter({ initialItems, initialUnread }: { initialItems: NotificationView[]; initialUnread: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  // "Connecting" until the first answer arrives, so the initial render is honest
  // about what is happening rather than claiming a connection that is not there yet.
  const [live, setLive] = useState<LiveState>({ status: "connecting" });
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [soundOn, setSoundOn] = useState(true);
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The ids already announced, so a notification is only ever announced once.
  // The first render is not an arrival: the list is what the page loaded with,
  // so announcing it would greet the reader with a chime for something that
  // happened before they arrived.
  const announced = useRef<Set<string> | null>(null);
  if (announced.current === null) {
    announced.current = new Set(initialItems.map((item) => item.id));
  }
  // Mirrors the connection state for the poller, which cannot read the state
  // variable without re-creating its interval on every change.
  const liveRef = useRef<LiveState["status"]>("connecting");

  useEffect(() => {
    setSoundOn(isNotificationSoundEnabled());
    // Browsers only allow sound after a gesture, so the audio context is
    // unlocked on the first one rather than on the notification.
    return unlockNotificationSound();
  }, []);

  /**
   * A notification is "seen" once the reader has actually reached the thing it
   * is about.
   *
   * Clicking it in the list is the obvious way, but the same thing happens
   * when the page a notification points at is opened by any other route — the
   * sidebar, a bookmark, a link inside a booking. Leaving the badge lit in
   * that case meant the count only ever went down when the bell happened to
   * be the thing that was clicked, which is not what "unread" should mean.
   */
  useEffect(() => {
    if (!pathname) return;
    const onThisPage = items.filter((item) => !item.read && item.href && isSameDestination(item.href, pathname));
    if (onThisPage.length === 0) return;
    // Mark them read locally straight away so the badge does not flicker, then
    // persist it. The server is the authority; a failure here only means the
    // badge comes back on the next load.
    setItems((current) => current.map((item) => (onThisPage.some((seen) => seen.id === item.id) ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - onThisPage.length));
    startTransition(async () => {
      await markNotificationsSeenAction(onThisPage.map((item) => item.id));
    });
    // `items` is deliberately not a dependency: the effect is about the page
    // changing, and re-running it for every items update would re-mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(window.Notification.permission);
  }, []);

  /**
   * One arrival path for every channel.
   *
   * The socket is the fast path, but a serverless deployment has none and its
   * polling fallback delivers the same notification as a changed prop. Both
   * call this, so neither can lose the in-page popup, chime, or browser alert.
   */
  const announce = useCallback(
    (item: NotificationView) => {
      announceNotification(item, { navigate: (href) => router.push(href) });
    },
    [router],
  );

  /**
   * Applies a list of notifications that came from the server.
   *
   * The same list arrives by two routes: as changed props when the page
   * re-renders, and as the answer of the polling fallback on a deployment with
   * no socket server. Both go through here, and anything that has not been
   * announced yet is announced once, whichever route delivered it.
   */
  const applyServerList = useCallback(
    (next: NotificationView[], unreadCount: number) => {
      const known = announced.current ?? new Set<string>();
      announced.current = known;
      const fresh = next.filter((item) => !known.has(item.id));
      for (const item of next) known.add(item.id);
      setItems(next);
      setUnread(unreadCount);
      for (const item of fresh) announce(item);
    },
    [announce],
  );

  useEffect(() => {
    /*
     * Announce anything that arrived since the last render.
     *
     * The socket is the fast path, but a deployment without the custom server
     * has none, and its polling fallback delivers the list instead. Either way
     * the new notification arrives here as a changed prop, so the sound and
     * the popup are raised from one place rather than two.
     */
    applyServerList(initialItems, initialUnread);
    // `applyServerList` is stable, and `items` is deliberately not a
    // dependency: this is about what the server has sent since last time.
  }, [initialItems, initialUnread, applyServerList]);

  useEffect(() => {
    // Authentication rides on the HttpOnly session cookie, which the browser
    // sends on the same-origin socket handshake. The server verifies the token
    // hash against the database before joining any room, so no token is ever
    // exposed to client JavaScript.
    let disposed = false;
    let socket: import("socket.io-client").Socket | null = null;
    let refreshSoon = false;

    async function connect() {
      const { io } = await import("socket.io-client");
      if (disposed) return;
      socket = io({
        path: "/api/socket.io",
        withCredentials: true,
        transports: ["websocket", "polling"],
        // A deployment without the custom server has no socket to reach, and
        // the default is to retry forever. The polling fallback below covers
        // that case, so the attempts stop instead of repeating all session.
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        timeout: 8000,
      });
      socket.on("connect", () => {
        liveRef.current = "live";
        setLive({ status: "live" });
      });
      socket.on("disconnect", (reason: string) => {
        liveRef.current = "offline";
        setLive({
          status: "offline",
          reason: reason === "io server disconnect" ? "The server closed the connection." : undefined,
        });
      });
      socket.on("connect_error", (error: Error) => {
        // Surfaced in the tooltip. A refused handshake says why here, which is the
        // difference between a network problem and a session that has expired.
        liveRef.current = "offline";
        setLive({ status: "offline", reason: error?.message });
      });
      socket.on("realtime:event", (event: { type?: string; notification?: NotificationView }) => {
        const incoming = event?.notification;
        if (incoming) {
          /*
           * Recorded as already announced before the refresh.
           *
           * The popup and chime are raised from this one place. The refresh
           * below then delivers the same notification again as a changed prop,
           * and without this the reader would hear the chime twice for one
           * notification.
           */
          const isNew = !announced.current?.has(incoming.id);
          announced.current?.add(incoming.id);
          if (isNew) {
            setItems((current) => [{ ...incoming }, ...current.filter((item) => item.id !== incoming.id)].slice(0, 30));
            setUnread((count) => count + 1);
            announce(incoming);
          }
        }
        if (refreshSoon) return;
        refreshSoon = true;
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          refreshSoon = false;
          router.refresh();
        }, 150);
      });
    }

    void connect();
    /*
     * The fallback for a deployment with no socket server, which is every
     * serverless one. It re-reads the page, so the notification list and the
     * unread count stay current, and the new items are announced the same way
     * a socket event would announce them.
     */
    const fallback = window.setInterval(async () => {
      router.refresh();
    }, 30_000);
    return () => {
      disposed = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.clearInterval(fallback);
      socket?.disconnect();
    };
  }, [router, announce]);

  useEffect(() => {
    /*
     * The notification poll.
     *
     * Socket.IO needs the custom server, so on Vercel there is none and the
     * only way to hear about a payment is to ask. This asks a small endpoint
     * for the newest notifications rather than re-rendering the page, so a
     * payment alert reaches the admin in seconds instead of waiting for the
     * next page refresh.
     *
     * It stays quiet while the socket is live: the push already delivered the
     * same notification, and announcing it twice would be noise.
     */
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      if (liveRef.current === "live") return;
      try {
        const response = await fetch("/api/admin/notifications", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { items?: NotificationView[]; unread?: number };
        if (cancelled || !Array.isArray(payload.items)) return;
        const unread = typeof payload.unread === "number" ? payload.unread : payload.items.filter((item) => !item.read).length;
        applyServerList(payload.items, unread);
      } catch {
        // A failed poll is not worth an error popup; the next tick tries again.
      }
    }

    const timer = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyServerList]);

  async function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await window.Notification.requestPermission();
    setPermission(result);
    localStorage.setItem(BROWSER_KEY, result === "granted" ? "on" : "off");
    if (result === "granted") {
      toast.success("Browser notifications enabled.");
    } else {
      toast.error("Browser notifications blocked. Enable them in your browser settings.");
    }
  }

  /**
   * Closes one notification.
   *
   * The row is marked read rather than deleted: the team inbox is a record of
   * what happened, and the badge counts what still needs looking at. Marking
   * it read also survives the next poll, so a closed notification does not
   * come back as unread.
   */
  function dismissItem(item: NotificationView) {
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)));
    if (!item.read) setUnread((count) => Math.max(0, count - 1));
    startTransition(async () => {
      await markNotificationsSeenAction([item.id]);
    });
  }

  function handleMarkAll() {
    startTransition(async () => {
      const result = await markAllNotificationsFormAction(new FormData());
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setItems((current) => current.map((item) => ({ ...item, read: true })));
      setUnread(0);
      toast.success(result?.success ?? "All notifications marked as read.");
      router.refresh();
    });
  }

  /**
   * Turns the chime on or off, and says so.
   *
   * Turning it on plays it once, so the reader hears what they turned on
   * without waiting for the next notification.
   */
  function handleToggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setNotificationSoundEnabled(next);
    if (next) {
      playNotificationSound();
      toast.success("Notification sound on.");
    } else {
      toast.success("Notification sound muted.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)] sm:inline-flex"
        title={
          live.status === "live"
            ? "Live updates connected"
            : live.status === "connecting"
              ? "Opening the live updates connection"
              : `Live updates unavailable${live.reason ? `: ${live.reason}` : ""}. The page still refreshes every minute.`
        }
        aria-live="polite"
      >
        {live.status === "live" ? (
          <Radio className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        ) : (
          <WifiOff className={`h-3.5 w-3.5 ${live.status === "connecting" ? "text-amber-600" : "text-red-600"}`} aria-hidden="true" />
        )}
        {LIVE_LABEL[live.status]}
      </span>

      {permission === "default" ? (
        <button
          type="button"
          onClick={requestPermission}
          className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] md:inline-flex"
        >
          <Settings2 className="h-3.5 w-3.5" /> Enable alerts
        </button>
      ) : null}

      {/*
        The sound is separate from the desktop notification: somebody may want
        the chime without the operating system's pop-up, and vice versa. The
        preference is remembered, so it is only asked once.
      */}
      <button
        type="button"
        onClick={handleToggleSound}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--muted)] transition hover:text-[var(--foreground)]"
        title={soundOn ? "Mute notification sound" : "Play a sound for notifications"}
        aria-label={soundOn ? "Mute notification sound" : "Play a sound for notifications"}
        aria-pressed={soundOn}
      >
        {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--foreground)]"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          aria-expanded={open}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>

        {open ? (
          <div className="absolute right-0 z-50 mt-2 w-[min(92vw,26rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              <div className="flex items-center gap-1">
                {unread > 0 ? (
                  <button type="button" onClick={handleMarkAll} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50">
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                ) : null}
                <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]" aria-label="Close notifications">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">You are all caught up.</p>
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {items.map((item) => (
                    <li key={item.id} className="group relative">
                      <Link
                        href={item.href}
                        onClick={() => {
                          setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)));
                          setUnread((count) => Math.max(0, count - (item.read ? 0 : 1)));
                          setOpen(false);
                        }}
                        className={cn("block px-4 py-3 pr-10 transition hover:bg-[var(--surface-muted)]", !item.read && "bg-amber-50/60")}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-amber-500")} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
                            <p className="mt-0.5 text-xs text-[var(--muted)]">{item.message}</p>
                            <p className="mt-1 text-[11px] text-[var(--muted)]">{relativeTime(item.createdAt)}</p>
                          </div>
                        </div>
                      </Link>
                      {/*
                        The per-item close. It clears the notification from the
                        list and marks it read on the server, so a closed
                        notification does not come back on the next render.
                      */}
                      <button
                        type="button"
                        onClick={() => dismissItem(item)}
                        className="absolute right-2 top-2 rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                        aria-label={`Dismiss notification: ${item.title}`}
                        title="Dismiss notification"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-[var(--line)] px-4 py-2">
              <Link href="/admin/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-amber-800 hover:underline">
                View all notifications
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
