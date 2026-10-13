import { RoleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/route-guards";
import { isAdminRole } from "@/lib/rbac";
import { slugify } from "@/lib/utils";
import { inventorySchema, inventoryUpdateSchema } from "@/lib/validation";

function ensureInventoryAccess(role: RoleKey) {
  if (!isAdminRole(role) && role !== RoleKey.STAFF) {
    throw new Error("FORBIDDEN");
  } 
}

function buildInventoryValues(data: {
  name: string;
  category: import("@prisma/client").InventoryCategory;
  totalQuantity: number;
  bookedQuantity: number;
  reorderLevel: number;
}) {
  const bookedQuantity = Math.min(data.bookedQuantity, data.totalQuantity);
  const availableQuantity = Math.max(0, data.totalQuantity - bookedQuantity);

  return {
    name: data.name.trim(),
    slug: slugify(data.name),
    category: data.category,
    totalQuantity: data.totalQuantity,
    bookedQuantity,
    availableQuantity,
    reorderLevel: data.reorderLevel,
  };
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    ensureInventoryAccess(user.role.key);

    const rawData = await request.json();
    const data = inventorySchema.parse(rawData);
    const values = buildInventoryValues(data);

    const existing = await prisma.inventory.findFirst({
      where: {
        OR: [{ name: values.name }, { slug: values.slug }],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Inventory item with this name already exists." },
        { status: 409 },
      );
    }

    const inventory = await prisma.inventory.create({
      data: values,
    });

    return NextResponse.json({ inventory }, { status: 201 });
  } catch (error) {
    return handleInventoryError(error, "Unable to create inventory item.");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    ensureInventoryAccess(user.role.key);

    const rawData = await request.json();
    const data = inventoryUpdateSchema.parse(rawData);

    const existingInventory = await prisma.inventory.findUnique({
      where: { id: data.id },
    });

    if (!existingInventory) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    const values = buildInventoryValues(data);

    const duplicate = await prisma.inventory.findFirst({
      where: {
        id: { not: data.id },
        OR: [{ name: values.name }, { slug: values.slug }],
      },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "Another inventory item already uses this name." },
        { status: 409 },
      );
    }

    const inventory = await prisma.inventory.update({
      where: { id: data.id },
      data: values,
    });

    return NextResponse.json({ inventory });
  } catch (error) {
    return handleInventoryError(error, "Unable to update inventory item.");
  }
}

function handleInventoryError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    if (error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ error: fallbackMessage }, { status: 400 });
}
