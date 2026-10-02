import { prisma } from "@/lib/prisma";

export async function getCustomerDashboardData(userId: string) {
  return prisma.customer.findFirst({
    where: { userId },
    include: {
      bookings: {
        include: {
          payments: true,
          invoice: true,
          bookingServices: {
            include: {
              service: true,
            },
          },
          package: true,
        },
        orderBy: { createdAt: "desc" },
      },
      user: {
        include: {
          notifications: {
            where: {
              audience: "CUSTOMER",
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      },
    },
  });
}

