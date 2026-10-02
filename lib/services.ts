import { InventoryCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inventorySchema, packageSchema, staffSchema } from "@/lib/validation";
import { slugify } from "@/lib/utils";

export async function createPackage(rawData: unknown) {
  const data = packageSchema.parse(rawData);
  const slug = slugify(data.name);

  return prisma.package.create({
    data: {
      name: data.name,
      slug,
      description: data.description,
      price: data.price,
      imageUrl: data.imageUrl || null,
      packageServices: {
        create: data.serviceIds.map((serviceId) => ({
          serviceId,
        })),
      },
    },
  });
}

export async function createInventoryItem(rawData: unknown, category: InventoryCategory) {
  const data = inventorySchema.parse(rawData);
  const slug = slugify(data.name);

  return prisma.inventory.create({
    data: {
      name: data.name,
      slug,
      category,
      totalQuantity: data.totalQuantity,
      bookedQuantity: 0,
      availableQuantity: data.totalQuantity,
      reorderLevel: data.reorderLevel,
    },
  });
}

/**
 * @deprecated Creating a staff account now goes through
 * `inviteTeamMember` in `@/lib/auth/team`, which issues a single-use activation
 * link and leaves the account without a credential until it is used. This
 * helper is kept only for the schema shape and is no longer referenced.
 */
export async function createStaff(rawData: unknown) {
  const data = staffSchema.parse(rawData);
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: "STAFF" },
  });

  return prisma.user.create({
    data: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      roleId: role.id,
      // No credential until the member activates with the emailed link.
      mustSetPassword: true,
      accountStatus: "PENDING_APPROVAL",
      staffProfile: {
        create: {
          staffType: data.staffType,
        },
      },
    },
    include: {
      staffProfile: true,
      role: true,
    },
  });
}

