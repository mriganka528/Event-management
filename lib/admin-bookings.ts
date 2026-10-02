import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";

export async function getAdminBookings(status?: BookingStatus) {
  await requireAdmin();
  const now = new Date();
  const where = status ? { status } : undefined;

  try {
    const [bookings, totalBookings, pendingBookings, approvedBookings, upcomingEvents, overdueBalances] =
      await Promise.all([
        prisma.booking.findMany({
          where,
          include: {
            customer: { include: { user: true } },
            package: true,
            invoice: true,
            payments: true,
          },
          orderBy: [{ eventDate: "asc" }, { createdAt: "desc" }],
          take: 100,
        }),
        prisma.booking.count(),
        prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
        prisma.booking.count({ where: { status: BookingStatus.APPROVED } }),
        prisma.booking.count({
          where: {
            eventDate: { gte: now },
            status: { in: [BookingStatus.APPROVED, BookingStatus.PREPARING] },
          },
        }),
        prisma.booking.count({
          where: {
            balanceAmount: { gt: 0 },
            status: { in: [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED] },
          },
        }),
      ]);

    return {
      bookings,
      metrics: {
        totalBookings,
        pendingBookings,
        approvedBookings,
        upcomingEvents,
        overdueBalances,
      },
    };
  } catch {
    return {
      bookings: [],
      metrics: {
        totalBookings: 0,
        pendingBookings: 0,
        approvedBookings: 0,
        upcomingEvents: 0,
        overdueBalances: 0,
      },
    };
  }
}

export async function getAdminBookingById(id: string) {
  await requireAdmin();
  return prisma.booking.findUnique({
    where: { id },
    include: {
      customer: { include: { user: true } },
      package: { include: { packageServices: { include: { service: true } } } },
      bookingServices: { include: { service: true } },
      bookingInventory: { include: { inventory: true } },
      bookingStaff: { include: { staff: { include: { user: true } } } },
      payments: { orderBy: { paidAt: "desc" } },
      invoice: true,
      event: true,
    },
  });
}
