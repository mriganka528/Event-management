import type { Metadata } from "next";
import { NotificationAudience } from "@prisma/client";
import { AdminSidebar } from "./component/admin-sidebar";
import { requireAdmin } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";
import { getBusinessSettings } from "@/lib/settings";
import { toNotificationView } from "@/lib/notification-links";
import { AdminNotificationCenter } from "@/components/admin/notification-center";
import { formatRoleLabel } from "@/lib/role-label";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Deny-by-default: an authenticated non-admin never reaches admin children.
  // The session is re-checked on every request, so a demoted, suspended, or
  // 2FA-disabled admin loses access immediately.
  const user = await requireAdmin();
  const [settings, notifications] = await Promise.all([
    // Cached across requests; invalidated when the settings screen saves.
    getBusinessSettings(),
    prisma.notification
      .findMany({
        where: { userId: user.id, audience: NotificationAudience.ADMIN },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
      .catch(() => []),
  ]);
  const businessName = settings.businessName;

  const items = notifications.map((notification) => toNotificationView(notification, "ADMIN"));
  const unread = items.filter((item) => !item.read).length;

  // The sidebar is a Client Component, so the identity is resolved here and
  // handed down as plain props. The session itself stays in the HttpOnly cookie.
  const account = {
    name: [user.firstName, user.lastName].filter(Boolean).join(" "),
    roleLabel: formatRoleLabel(user.role),
  };

  return (
    <div className="min-h-screen sm:py-6">
      <div className="mx-auto flex w-full px-4 lg:px-10 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <AdminSidebar businessName={businessName} logoUrl={settings.logoUrl} account={account} />
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex justify-end">
            <AdminNotificationCenter initialItems={items} initialUnread={unread} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
