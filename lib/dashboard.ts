import { prisma } from "@/lib/prisma";

/**
 * The customer dashboard's slice of the database.
 *
 * This used to pull every booking with every payment, invoice, service, and
 * package attached — none of which the dashboard rendered. The page now has a
 * payment history section, so it selects only the ledger fields that section
 * prints. On a Neon connection that keeps a summary screen from turning into
 * several hundred rows over the wire.
 */
export async function getCustomerDashboardData(userId: string) {
  return prisma.customer.findFirst({
    where: { userId },
    select: {
      bookings: {
        select: {
          id: true,
          eventType: true,
          status: true,
          eventDate: true,
          // The length of the event, so the customer sees the span they picked
          // rather than a start date and a number.
          durationDays: true,
          location: true,
          guestCount: true,
          totalAmount: true,
          paidAmount: true,
          balanceAmount: true,
          paymentRequestTargetAmount: true,
          paymentRequestMode: true,
          invoice: { select: { id: true } },
          payments: {
            orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              amount: true,
              status: true,
              stage: true,
              method: true,
              provider: true,
              reference: true,
              paidAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      user: {
        select: {
          notifications: {
            where: { audience: "CUSTOMER" },
            orderBy: { createdAt: "desc" },
            take: 5,
            // `href` is the page the update is about, so the customer can go
            // straight to it; `read` is what the list is filtered on.
            select: { id: true, title: true, message: true, type: true, createdAt: true, href: true, read: true },
          },
        },
      },
    },
    // Bookings, their invoices, and the user's notifications are one join
    // instead of five sequential round trips on a remote database.
    relationLoadStrategy: "join",
  });
}
