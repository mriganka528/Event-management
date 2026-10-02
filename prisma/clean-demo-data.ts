import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const demoPackageSlugs = ["basic-package", "premium-package", "luxury-package"];
const demoServiceSlugs = ["tent", "chairs", "tables", "lighting", "dj", "stage-decoration", "catering", "photography"];
const demoInventorySlugs = [
  "premium-tent-set",
  "banquet-chairs",
  "dining-tables",
  "led-lighting-rig",
  "stage-platforms",
  "dj-consoles",
  "decor-props",
  "catering-capacity",
  "photography-kits",
];
const demoStaffEmails = ["decorator@tenthousepro.com", "installer@tenthousepro.com", "electrician@tenthousepro.com"];

async function main() {
  if (!process.argv.includes("--confirm")) {
    throw new Error("Refusing to remove demo data without --confirm.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const packages = await tx.package.findMany({
      where: { slug: { in: demoPackageSlugs } },
      select: { id: true, slug: true, _count: { select: { bookings: true } } },
    });
    for (const item of packages) {
      if (item._count.bookings > 0) {
        await tx.package.update({ where: { id: item.id }, data: { isActive: false } });
      } else {
        await tx.package.delete({ where: { id: item.id } });
      }
    }

    const services = await tx.service.findMany({
      where: { slug: { in: demoServiceSlugs } },
      select: { id: true, slug: true, _count: { select: { bookingServices: true, packageServices: true } } },
    });
    for (const item of services) {
      if (item._count.bookingServices > 0 || item._count.packageServices > 0) {
        await tx.service.update({ where: { id: item.id }, data: { isActive: false } });
      } else {
        await tx.service.delete({ where: { id: item.id } });
      }
    }

    const inventory = await tx.inventory.findMany({
      where: { slug: { in: demoInventorySlugs } },
      select: { id: true, slug: true, _count: { select: { bookingInventory: true } } },
    });
    for (const item of inventory) {
      if (item._count.bookingInventory > 0) {
        await tx.inventory.update({ where: { id: item.id }, data: { isActive: false } });
      } else {
        await tx.inventory.delete({ where: { id: item.id } });
      }
    }

    // Demo staff have no booking history, so they can be removed outright. Any
    // account that is referenced is left alone.
    const staff = await tx.user.deleteMany({
      where: {
        OR: [{ email: { in: demoStaffEmails } }, { role: { key: "STAFF" }, customerProfile: null }],
      },
    });

    const settings = await tx.businessSetting.findUnique({ where: { id: "default" }, select: { businessName: true, email: true, phone: true, address: true, city: true } });
    if (settings && (settings.businessName === "Tent House Pro" || settings.email === "hello@tenthousepro.com" || settings.phone === "+91 98765 43210" || settings.address === "Event Market Road, Jaipur" || settings.city === "Jaipur")) {
      await tx.businessSetting.update({ where: { id: "default" }, data: { businessName: "", email: "", phone: "", address: "", city: "" } });
    }

    return {
      packages: packages.length,
      services: services.length,
      inventory: inventory.length,
      staff: staff.count,
    };
  }, { maxWait: 10_000, timeout: 60_000 });

  console.log("Demo data cleanup complete", result);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
