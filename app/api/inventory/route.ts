import { RoleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied, requireApiUser, type AuthUser } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { slugify } from "@/lib/utils";
import { inventorySchema, inventoryUpdateSchema } from "@/lib/validation";
import { rateLimitApi, rejectCrossSiteMutation, rejectOversizedBody } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Inventory is operational data, and changing it is an administrator
 * responsibility.
 *
 * `requireApiUser` resolves to an `AuthUser`, whose `role` is the `RoleKey`
 * enum itself rather than the Prisma `Role` row the rest of the codebase
 * selects. Binding it here with an explicit annotation keeps that distinction
 * visible and makes `caller.role.key` — which does not exist on the enum — a
 * compile error rather than a runtime `undefined`.
 *
 * Staff are refused here for the same reason the server actions refuse them:
 * every other path that writes stock requires an administrator, and a second
 * path with a weaker rule is a hole in that rule rather than an exception to
 * it.
 */
function ensureInventoryAccess(caller: AuthUser) {
  const role: RoleKey = caller.role;
  if (role !== RoleKey.SUPER_ADMIN && role !== RoleKey.ADMIN) {
    throw new Error("FORBIDDEN");
  }
}

/**
 * The quantities an item is actually held at.
 *
 * `bookedQuantity` and `availableQuantity` are derived from the reservations
 * that exist, never from a number the caller supplied. A client that said
 * `bookedQuantity: 0` for an item with live reservations would otherwise make
 * the units look free, and the booking that reserved them would be allowed to
 * oversell the stock.
 */
async function resolveStock(inventoryId: string | null, totalQuantity: number) {
  const reserved = inventoryId
    ? (await prisma.bookingInventory.aggregate({ where: { inventoryId }, _sum: { quantity: true } }))._sum.quantity ?? 0
    : 0;
  if (totalQuantity < reserved) {
    throw new Error(`Total quantity cannot be lower than the ${reserved} unit(s) already reserved.`);
  }
  return { bookedQuantity: reserved, availableQuantity: totalQuantity - reserved };
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, MAX_BODY_BYTES);
  if (oversized) return oversized;
  try {
    const caller = await requireApiUser();
    ensureInventoryAccess(caller);
    const limited = rateLimitApi(request, "inventory-create", { limit: 60, windowMs: 60_000, keySuffix: caller.id });
    if (limited) return limited;

    const rawData = await request.json();
    const data = inventorySchema.parse(rawData);
    const values = await resolveStock(null, data.totalQuantity);

    const existing = await prisma.inventory.findFirst({
      where: {
        OR: [{ name: data.name.trim() }, { slug: slugify(data.name) }],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Inventory item with this name already exists." },
        { status: 409 },
      );
    }

    const inventory = await prisma.inventory.create({
      data: {
        name: data.name.trim(),
        slug: slugify(data.name),
        category: data.category,
        totalQuantity: data.totalQuantity,
        bookedQuantity: values.bookedQuantity,
        availableQuantity: values.availableQuantity,
        reorderLevel: data.reorderLevel,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
      },
    });

    return NextResponse.json({ inventory }, { status: 201 });
  } catch (error) {
    return handleInventoryError(error, "Unable to create inventory item.");
  }
}

export async function PUT(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, MAX_BODY_BYTES);
  if (oversized) return oversized;
  try {
    const caller = await requireApiUser();
    ensureInventoryAccess(caller);
    const limited = rateLimitApi(request, "inventory-update", { limit: 60, windowMs: 60_000, keySuffix: caller.id });
    if (limited) return limited;

    const rawData = await request.json();
    const data = inventoryUpdateSchema.parse(rawData);

    const existingInventory = await prisma.inventory.findUnique({
      where: { id: data.id },
    });

    if (!existingInventory) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    // Reserved units belong to the bookings that hold them, so the counters
    // are recomputed from those bookings rather than taken from the request.
    const values = await resolveStock(data.id, data.totalQuantity);

    const duplicate = await prisma.inventory.findFirst({
      where: {
        id: { not: data.id },
        OR: [{ name: data.name.trim() }, { slug: slugify(data.name) }],
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
      data: {
        name: data.name.trim(),
        slug: slugify(data.name),
        category: data.category,
        totalQuantity: data.totalQuantity,
        bookedQuantity: values.bookedQuantity,
        availableQuantity: values.availableQuantity,
        reorderLevel: data.reorderLevel,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
      },
    });

    return NextResponse.json({ inventory });
  } catch (error) {
    return handleInventoryError(error, "Unable to update inventory item.");
  }
}

function handleInventoryError(error: unknown, fallbackMessage: string) {
  if (error instanceof AuthError) {
    return accessDenied(error, fallbackMessage);
  }
  if (error instanceof Error) {
    if (error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // A quantity that would strand a live reservation is the caller's mistake
    // and is reported as one, so the correction is obvious.
    if (error.message.startsWith("Total quantity cannot be lower than")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: fallbackMessage }, { status: 400 });
}
