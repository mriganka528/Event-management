import { Bell, CheckCheck, MailOpen } from "lucide-react";
import { getAdminNotifications } from "@/lib/admin-data";
import { requireAdminPage } from "@/lib/route-guards";
import { markAllNotificationsFormAction, markNotificationFormAction } from "@/lib/form-actions";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  // Defence in depth: the admin layout already guards, this keeps the page
  // safe if it is ever rendered outside that layout.
  const user = await requireAdminPage();
  const notifications = await getAdminNotifications(user.id);
  const unread = notifications.filter((notification) => !notification.read).length;
  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Team inbox</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Stay a step ahead.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Booking requests, low-stock alerts, and event reminders in one feed.</p></div>{unread > 0 ? <ActionForm action={markAllNotificationsFormAction}><SubmitButton variant="outline"><CheckCheck className="mr-2 h-4 w-4" />Mark all read</SubmitButton></ActionForm> : null}</section>
      <Card><CardHeader><CardTitle className="text-2xl">Notifications</CardTitle><CardDescription>{unread} unread of {notifications.length} total.</CardDescription></CardHeader><CardContent>{notifications.length === 0 ? <EmptyState title="You are all caught up" description="New operational alerts will appear here." /> : <div className="grid gap-3">{notifications.map((notification) => <div key={notification.id} className={`flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${notification.read ? "border-stone-200 bg-white" : "border-amber-200 bg-amber-50/60"}`}><div className="flex items-start gap-3"><span className={`rounded-2xl p-3 ${notification.read ? "bg-stone-100 text-stone-600" : "bg-amber-100 text-amber-800"}`}>{notification.read ? <MailOpen className="h-5 w-5" /> : <Bell className="h-5 w-5" />}</span><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{notification.title}</p>{!notification.read ? <Badge className="bg-amber-100 text-amber-800">New</Badge> : null}</div><p className="mt-1 text-sm text-[var(--muted)]">{notification.message}</p><p className="mt-2 text-xs text-[var(--muted)]">{formatDate(notification.createdAt)}</p></div></div>{!notification.read ? <ActionForm action={markNotificationFormAction}><input type="hidden" name="notificationId" value={notification.id} /><Button type="submit" size="sm" variant="outline">Mark read</Button></ActionForm> : null}</div>)}</div>}</CardContent></Card>
    </main>
  );
}
