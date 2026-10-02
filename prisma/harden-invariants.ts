import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Inventory_quantities_nonnegative') THEN ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_quantities_nonnegative" CHECK ("totalQuantity" >= 0 AND "bookedQuantity" >= 0 AND "availableQuantity" >= 0); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Inventory_quantities_consistent') THEN ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_quantities_consistent" CHECK ("bookedQuantity" <= "totalQuantity" AND "availableQuantity" = "totalQuantity" - "bookedQuantity"); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Inventory_quantities_bounded') THEN ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_quantities_bounded" CHECK ("totalQuantity" <= 100000000 AND "bookedQuantity" <= 100000000 AND "availableQuantity" <= 100000000); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_amounts_nonnegative') THEN ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amounts_nonnegative" CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "totalAmount" >= 0 AND "paidAmount" >= 0 AND "balanceAmount" >= 0 AND "reservedPaymentAmount" >= 0); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_amounts_bounded') THEN ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amounts_bounded" CHECK ("subtotal" <= 100000000 AND "taxAmount" <= 100000000 AND "totalAmount" <= 100000000 AND "paidAmount" <= 100000000 AND "balanceAmount" <= 100000000 AND "reservedPaymentAmount" <= 100000000); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_payment_totals_consistent') THEN ALTER TABLE "Booking" ADD CONSTRAINT "Booking_payment_totals_consistent" CHECK ("paidAmount" + "balanceAmount" = "totalAmount"); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_reserved_payment_valid') THEN ALTER TABLE "Booking" ADD CONSTRAINT "Booking_reserved_payment_valid" CHECK ("reservedPaymentAmount" <= "balanceAmount"); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_amount_positive') THEN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_amount_bounded') THEN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_bounded" CHECK ("amount" <= 100000000); END IF; END $$;`,
];

async function main() {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log(`Applied ${statements.length} database invariant checks.`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
