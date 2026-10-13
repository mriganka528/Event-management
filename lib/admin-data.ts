import { AccountStatus, BookingStatus, NotificationAudience, RoleKey, type SecurityEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSuperAdmin } from "@/lib/rbac";

/** The roles the access-control screen is about. */
const ADMIN_ROLE_KEYS = [RoleKey.SUPER_ADMIN, RoleKey.ADMIN];

export async function getAdminDashboardData() {
  await requireAdmin();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const [
      totalBookings,
      pendingBookings,
      approvedBookings,
      upcomingEvents,
      overdueBalances,
      totalRevenue,
      collectedRevenue,
      upcoming,
      recentRequests,
      lowStock,
      monthlyBookings,
    ] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      prisma.booking.count({ where: { status: BookingStatus.APPROVED } }),
      prisma.booking.count({
        where: { eventDate: { gte: now }, status: { in: [BookingStatus.APPROVED, BookingStatus.PREPARING] } },
      }),
      prisma.booking.count({ where: { balanceAmount: { gt: 0 }, status: { in: [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED] } } }),
      prisma.booking.aggregate({ _sum: { totalAmount: true }, where: { createdAt: { gte: monthStart }, status: { notIn: [BookingStatus.PENDING, BookingStatus.CANCELLED, BookingStatus.REJECTED] } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "CAPTURED", paidAt: { gte: monthStart } } }),
      prisma.booking.findMany({
        where: { eventDate: { gte: now }, status: { in: [BookingStatus.APPROVED, BookingStatus.PREPARING] } },
        include: { customer: { include: { user: true } }, package: true },
        orderBy: { eventDate: "asc" },
        take: 6,
      }),
      prisma.booking.findMany({
        where: { status: BookingStatus.PENDING },
        include: { customer: { include: { user: true } }, package: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.inventory.findMany({ orderBy: { availableQuantity: "asc" }, take: 20 }).then((items) => items.filter((item) => item.availableQuantity <= item.reorderLevel).slice(0, 5)).catch(() => []),
      prisma.booking.findMany({
        where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } },
        select: { createdAt: true, totalAmount: true, status: true },
      }),
    ]);

    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const revenue = monthlyBookings
        .filter((booking) => {
          const created = new Date(booking.createdAt);
          return (
            ["PENDING", "CANCELLED", "REJECTED"].includes(booking.status) === false &&
            `${created.getFullYear()}-${created.getMonth()}` === key
          );
        })
        .reduce((sum, booking) => sum + Number(booking.totalAmount), 0);
      return { label: date.toLocaleDateString("en-IN", { month: "short" }), revenue };
    });

    return {
      metrics: {
        totalBookings,
        pendingBookings,
        approvedBookings,
        upcomingEvents,
        overdueBalances,
        totalRevenue: Number(totalRevenue._sum.totalAmount ?? 0),
        collectedRevenue: Number(collectedRevenue._sum.amount ?? 0),
      },
      upcoming,
      recentRequests,
      lowStock,
      months,
    };
  } catch {
    return {
      metrics: { totalBookings: 0, pendingBookings: 0, approvedBookings: 0, upcomingEvents: 0, overdueBalances: 0, totalRevenue: 0, collectedRevenue: 0 },
      upcoming: [],
      recentRequests: [],
      lowStock: [],
      months: Array.from({ length: 6 }, (_, index) => ({ label: new Date(now.getFullYear(), now.getMonth() - 5 + index, 1).toLocaleDateString("en-IN", { month: "short" }), revenue: 0 })),
    };
  }
}

export async function getAdminInventory() {
  await requireAdmin();
  try {
    return await prisma.inventory.findMany({ orderBy: [{ availableQuantity: "asc" }, { name: "asc" }] });
  } catch {
    return [];
  }
}

export async function getAdminPackages() {
  await requireAdmin();
  try {
    return await prisma.package.findMany({
      include: { packageServices: { include: { service: true } }, _count: { select: { bookings: true } } },
      orderBy: { price: "asc" },
    });
  } catch {
    return [];
  }
}

export async function getAdminServices() {
  await requireAdmin();
  try {
    return await prisma.service.findMany({ include: { _count: { select: { bookingServices: true, packageServices: true } } }, orderBy: { name: "asc" } });
  } catch {
    return [];
  }
}

export async function getAdminStaff() {
  await requireAdmin();
  try {
    return await prisma.staff.findMany({
      include: { user: true, managedBy: { include: { user: true } }, assignments: { include: { booking: { include: { customer: { include: { user: true } } } } } } },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return [];
  }
}

export async function getAdminCustomers() {
  await requireAdmin();
  try {
    return await prisma.customer.findMany({
      include: { user: true, bookings: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, eventType: true, totalAmount: true, eventDate: true } } },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return [];
  }
}

export async function getAdminPayments() {
  await requireAdmin();
  try {
    return await prisma.payment.findMany({
      where: { status: "CAPTURED" },
      include: { booking: { include: { customer: { include: { user: true } }, event: true } } },
      orderBy: { paidAt: "desc" },
    });
  } catch {
    return [];
  }
}

export async function getAdminPaymentOrders() {
  await requireAdmin();
  try {
    return await prisma.paymentOrder.findMany({
      include: { booking: { include: { customer: { include: { user: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } catch {
    return [];
  }
}

export async function getAdminInvoices() {
  await requireAdmin();
  try {
    return await prisma.invoice.findMany({
      include: { booking: { include: { customer: { include: { user: true } }, event: true } } },
      orderBy: { issuedAt: "desc" },
    });
  } catch {
    return [];
  }
}

export async function getAdminEvents() {
  await requireAdmin();
  try {
    return await prisma.event.findMany({
      include: { booking: { include: { customer: { include: { user: true } } } } },
      orderBy: { startDate: "asc" },
    });
  } catch {
    return [];
  }
}

export async function getAdminNotifications(userId: string) {
  await requireAdmin();
  try {
    return await prisma.notification.findMany({
      where: { audience: NotificationAudience.ADMIN, userId },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } catch {
    return [];
  }
}

/**
 * Accounts that hold — or are waiting to hold — an administrator role.
 *
 * Staff and customers are deliberately excluded from this list. `/admin/staff`
 * and `/admin/customers` already own those records, and duplicating every
 * customer account here made the access-control screen unusable and let a
 * super admin change a customer's role from the wrong page.
 *
 * Filtered in the query rather than in the component so the counts in the
 * header and the rows in the table are guaranteed to describe the same set.
 */
export async function getAdminUsers() {
  await requireAdmin();
  try {
    // Role ids are resolved by key, not hard-coded, so a seeded database and a
    // migrated one behave the same.
    const adminRoles = await prisma.role.findMany({ where: { key: { in: ADMIN_ROLE_KEYS } }, select: { id: true } });
    const [users, requests] = await Promise.all([
      prisma.user.findMany({
        where: { roleId: { in: adminRoles.map((role) => role.id) } },
        include: {
          role: true,
          adminProfile: true,
          staffProfile: true,
          approvedBy: { select: { firstName: true, lastName: true } },
          customerProfile: { include: { _count: { select: { bookings: true } } } },
        },
        orderBy: [{ accountStatus: "asc" }, { createdAt: "desc" }],
      }),
      prisma.adminAccessRequest.findMany({
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { users, requests };
  } catch {
    return { users: [], requests: [] };
  }
}

/** Append-only security audit feed. Super-admin only. */
export async function getSecurityEvents(options: { take?: number; type?: SecurityEventType } = {}) {
  await requireSuperAdmin();
  try {
    const events = await prisma.securityEvent.findMany({
      where: options.type ? { type: options.type } : undefined,
      include: { user: { select: { firstName: true, lastName: true, email: true, role: { select: { key: true } } } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(options.take ?? 100, 1), 500),
    });
    const [pendingAccounts, blockedSignIns] = await Promise.all([
      prisma.user.count({ where: { accountStatus: AccountStatus.PENDING_APPROVAL } }),
      prisma.securityEvent.count({ where: { type: { in: ["SIGN_IN_BLOCKED", "BLOCKED_ROUTE_ATTEMPT"] } } }),
    ]);
    return { events, pendingAccounts, blockedSignIns };
  } catch {
    return { events: [], pendingAccounts: 0, blockedSignIns: 0 };
  }
}

export async function getAdminReports() {
  await requireAdmin();
  try {
    const [bookings, payments] = await Promise.all([
      prisma.booking.findMany({ select: { eventType: true, status: true, totalAmount: true, paidAmount: true, balanceAmount: true, eventDate: true, createdAt: true } }),
      prisma.payment.findMany({ where: { status: "CAPTURED" }, select: { amount: true, method: true, stage: true, paidAt: true } }),
    ]);
    const billableBookings = bookings.filter((booking) => !["PENDING", "CANCELLED", "REJECTED"].includes(booking.status));
    const byType = new Map<string, { count: number; revenue: number }>();
    for (const booking of billableBookings) {
      const current = byType.get(booking.eventType) ?? { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += Number(booking.totalAmount);
      byType.set(booking.eventType, current);
    }
    const byStatus = Object.values(BookingStatus).map((status) => ({ status, count: bookings.filter((booking) => booking.status === status).length }));
    const byMethod = Object.entries(payments.reduce<Record<string, number>>((result, payment) => {
      result[payment.method] = (result[payment.method] ?? 0) + Number(payment.amount);
      return result;
    }, {})).map(([method, amount]) => ({ method, amount }));
    const revenue = billableBookings.reduce((sum, booking) => sum + Number(booking.totalAmount), 0);
    const collected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    return {
      totals: {
        bookings: bookings.length,
        revenue,
        collected,
        outstanding: billableBookings.reduce((sum, booking) => sum + Number(booking.balanceAmount), 0),
      },
      byType: Array.from(byType.entries()).map(([eventType, value]) => ({ eventType, ...value })),
      byStatus,
      byMethod,
    };
  } catch {
    return { totals: { bookings: 0, revenue: 0, collected: 0, outstanding: 0 }, byType: [], byStatus: [], byMethod: [] };
  }
}
