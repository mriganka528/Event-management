import { PrismaClient, RoleKey } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * System bootstrap only. Catalog, inventory, staff, packages, and business
 * content are intentionally created from the admin panel after deployment.
 *
 * No account is created here. The first super admin comes from
 * `npm run admin:bootstrap`, and every later account is provisioned by a sign-in
 * that lands in PENDING_APPROVAL until an administrator approves it.
 */
async function main() {
  const roles = [
    { key: RoleKey.SUPER_ADMIN, name: "Super Admin", description: "Full system access" },
    { key: RoleKey.ADMIN, name: "Admin", description: "Manages bookings, inventory, and staff" },
    { key: RoleKey.STAFF, name: "Staff", description: "Handles operational tasks" },
    { key: RoleKey.CUSTOMER, name: "Customer", description: "Books services and events" },
  ];

  for (const role of roles) {
    await prisma.role.upsert({ where: { key: role.key }, update: role, create: role });
  }

  await prisma.businessSetting.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      businessName: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      taxRate: 0.18,
      currency: "INR",
    },
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
