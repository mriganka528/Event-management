import { Bell, CheckCheck, ExternalLink, MailOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminNotifications } from "@/lib/admin-data";
import { requireAdminPage } from "@/lib/route-guards";
import { markAllNotificationsFormAction, markNotificationFormAction } from "@/lib/form-actions";
import { toNotificationView } from "@/lib/notification-links";
import { AdminSearch } from "@/components/admin/admin-search";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Every operational alert, including low inventory and out-of-stock warnings.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  // Defence in depth: the admin layout already guards, this keeps the page
  // safe if it is ever rendered outside that layout.
  const user = await requireAdminPage();
  const query = normalizeQuery((await searchParams).q);
  const notifications = await getAdminNotifications(user.id);
  // Rows stay in the DOM and non-matching ones are hidden, so the browser can
  // reveal them again without a round trip.
  const visibility = rowFilter(query);
  const notificationText = (notification: (typeof notifications)[number]) => rowText(notification.title, notification.message, notification.type);
  const unread = notifications.filter((notification) => !notification.read).length;
  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search notifications"
        placeholder="Search alerts by title, message, or type…"
      />
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Team inbox</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Stay a step ahead.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Booking requests, low-stock alerts, and event reminders in one feed.</p></div>{unread > 0 ? <ActionForm action={markAllNotificationsFormAction}><SubmitButton variant="outline"><CheckCheck className="mr-2 h-4 w-4" />Mark all read</SubmitButton></ActionForm> : null}</section>
      <Card><CardHeader><CardTitle className="text-2xl">Notifications</CardTitle><CardDescription>{unread} unread of {notifications.length} total.</CardDescription></CardHeader><CardContent>{notifications.length === 0 ? <EmptyState title="You are all caught up" description="New operational alerts will appear here." /> : <div className="grid gap-3">{notifications.map((notification) => {
        // The link each alert is about, so a row can be followed to the task
        // rather than only read.
        const view = toNotificationView(notification, "ADMIN");
        return <div key={notification.id} data-row-id={notification.id} data-row-text={notificationText(notification)} style={visibility(notificationText(notification))} className={`flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${notification.read ? "border-stone-200 bg-white" : "border-amber-200 bg-amber-50/60"}`}><div className="flex min-w-0 items-start gap-3"><span className={`shrink-0 rounded-2xl p-3 ${notification.read ? "bg-stone-100 text-stone-600" : "bg-amber-100 text-amber-800"}`}>{notification.read ? <MailOpen className="h-5 w-5" /> : <Bell className="h-5 w-5" />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{notification.title}</p>{!notification.read ? <Badge className="bg-amber-100 text-amber-800">New</Badge> : null}</div><p className="mt-1 break-words text-sm text-[var(--muted)]">{notification.message}</p><p className="mt-2 text-xs text-[var(--muted)]">{formatDate(notification.createdAt)}</p></div></div><div className="flex shrink-0 flex-wrap items-center gap-2"><Link href={view.href} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"><ExternalLink className="h-3.5 w-3.5" />Open</Link>{!notification.read ? <ActionForm action={markNotificationFormAction}><input type="hidden" name="notificationId" value={notification.id} /><Button type="submit" size="sm" variant="outline">Mark read</Button></ActionForm> : null}</div></div>;
      })}</div>}</CardContent></Card>
    </main>
  );
}
