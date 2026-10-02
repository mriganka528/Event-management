"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellRing, CheckCheck, Radio, Settings2, WifiOff, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { markAllNotificationsFormAction } from "@/lib/form-actions";
import { cn } from "@/lib/utils";
import type { NotificationView } from "@/lib/notification-links";

const BROWSER_KEY = "staff-browser-notifications";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function AdminNotificationCenter({ initialItems, initialUnread }: { initialItems: NotificationView[]; initialUnread: number }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setItems(initialItems);
    setUnread(initialUnread);
  }, [initialItems, initialUnread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(window.Notification.permission);
  }, []);

  const showBrowserNotification = useCallback((item: NotificationView) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;
    if (localStorage.getItem(BROWSER_KEY) === "off") return;
    try {
      const notification = new window.Notification(item.title, {
        body: item.message,
        tag: item.id,
        icon: "/icon.svg",
      });
      notification.onclick = () => {
        window.focus();
        router.push(item.href);
        notification.close();
      };
    } catch {
      // Some browsers block constructing notifications outside a user gesture.
    }
  }, [router]);

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
      socket = io({ path: "/api/socket.io", withCredentials: true, transports: ["websocket", "polling"] });
      socket.on("connect", () => setConnected(true));
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => setConnected(false));
      socket.on("realtime:event", (event: { type?: string; notification?: NotificationView }) => {
        const incoming = event?.notification;
        if (incoming) {
          setItems((current) => {
            if (current.some((item) => item.id === incoming.id)) return current;
            return [{ ...incoming }, ...current].slice(0, 30);
          });
          setUnread((count) => count + 1);
          toast.custom(
            <div className="flex items-start gap-2">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span className="flex flex-col">
                <span className="font-semibold">{incoming.title}</span>
                <span className="text-xs font-normal opacity-80">{incoming.message}</span>
              </span>
            </div>,
            { icon: null, duration: 6000 },
          );
          showBrowserNotification(incoming);
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
    const fallback = window.setInterval(() => router.refresh(), 60_000);
    return () => {
      disposed = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.clearInterval(fallback);
      socket?.disconnect();
    };
  }, [router, showBrowserNotification]);

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

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)] sm:inline-flex"
        title={connected ? "Live updates connected" : "Live updates reconnecting"}
        aria-live="polite"
      >
        {connected ? <Radio className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 text-amber-600" />}
        {connected ? "Live" : "Connecting"}
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
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        onClick={() => {
                          setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)));
                          setUnread((count) => Math.max(0, count - (item.read ? 0 : 1)));
                          setOpen(false);
                        }}
                        className={cn("block px-4 py-3 transition hover:bg-[var(--surface-muted)]", !item.read && "bg-amber-50/60")}
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
