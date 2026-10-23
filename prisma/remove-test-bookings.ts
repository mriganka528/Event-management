import "dotenv/config";

import { NotificationType, PrismaClient } from "@prisma/client";

/**
 * Removes bookings created while testing, and the customer accounts they
 * conjured into existence.
 *
 * Scope is deliberately narrow: only bookings whose customer email is on the
 * `@example.com` domain, which RFC 2606 reserves for documentation and examples.
 * A real enquiry cannot arrive on it, so nothing a customer sent is ever in
 * range, and the rule does not depend on remembering which test ran.
 *
 * Three things have to be undone together, and missing any one of them leaves
 * something behind that looks like a bug rather than a cleanup:
 *
 *  1. the stock a booking was holding. `bookedQuantity` is a counter, so the
 *     cascade that deletes `bookingInventory` does not hand those units back —
 *     without this the units stay unavailable forever.
 *  2. the booking itself. Its services, staff, payments, and invoice cascade.
 *  3. the customer account, which the booking flow *creates* on demand — so the
 *     admin customer list is full of one-off profiles nobody ever asked for.
 *
 *   npm run db:clean:test-bookings -- --dry-run
 *   npm run db:clean:test-bookings -- --confirm
 */

const prisma = new PrismaClient();

/** RFC 2606: reserved for documentation, examples, and testing. */
const TEST_EMAIL_DOMAIN = "@example.com";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !process.argv.includes("--confirm")) {
    throw new Error("Refusing to remove anything without --confirm (or --dry-run to see what would go).");
  }

  const bookings = await prisma.booking.findMany({
    where: { customer: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } },
    select: {
      id: true,
      totalAmount: true,
      customer: { select: { user: { select: { email: true } } } },
      bookingInventory: { select: { inventoryId: true, quantity: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`test bookings found: ${bookings.length}`);
  for (const booking of bookings) {
    const held = booking.bookingInventory.reduce((sum, row) => sum + row.quantity, 0);
    console.log(`  ${booking.id}  ${booking.customer.user.email.padEnd(30)} ${String(booking.totalAmount).padStart(10)}  holding ${held} unit(s)`);
  }
  if (bookings.length === 0) {
    console.log("nothing to do.");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run: nothing was written.");
    return;
  }

  const ids = bookings.map((booking) => booking.id);

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Hand the reserved units back before the rows that record them go.
      //    Clamped to `totalQuantity`, the same rule the rejection path uses, so a
      //    stock edit made since the booking cannot push availability past the
      //    total it was counted from.
      let releasedUnits = 0;
      for (const row of await tx.bookingInventory.findMany({ where: { bookingId: { in: ids } } })) {
        await tx.inventory.update({
          where: { id: row.inventoryId },
          data: { bookedQuantity: { decrement: row.quantity }, availableQuantity: { increment: row.quantity } },
        });
        const latest = await tx.inventory.findUnique({ where: { id: row.inventoryId }, select: { totalQuantity: true, availableQuantity: true } });
        if (latest && latest.availableQuantity > latest.totalQuantity) {
          await tx.inventory.update({ where: { id: row.inventoryId }, data: { availableQuantity: latest.totalQuantity } });
        }
        releasedUnits += row.quantity;
      }

      // 2. The bookings. Services, staff, payments, and the invoice cascade.
      const deletedBookings = await tx.booking.deleteMany({ where: { id: { in: ids } } });

      // 3. The alerts the bookings raised for the admins. Only safe to clear
      //    wholesale because these were every booking there was — a notification
      //    for a booking that still exists would be deleted on the way out.
      const remainingBookings = await tx.booking.count();
      const deletedNotifications = remainingBookings === 0 ? await tx.notification.deleteMany({ where: { type: NotificationType.NEW_BOOKING_REQUEST } }) : { count: 0 };

      // 4. The customer accounts those bookings created on the way in. Ordered
      //    after the bookings because `Booking.customer` restricts the delete,
      //    and `Customer.user` restricts it again.
      const deletedCustomers = await tx.customer.deleteMany({ where: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } });
      const deletedUsers = await tx.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });

      return {
        releasedUnits,
        bookings: deletedBookings.count,
        notifications: deletedNotifications.count,
        customers: deletedCustomers.count,
        users: deletedUsers.count,
      };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  console.log("\nremoved:", result);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
