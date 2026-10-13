import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { InventoryCategory, RoleKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accessDenied, requireApiAdmin, requireApiStaff, type AuthUser } from "@/lib/route-guards";
import { slugify } from "@/lib/utils";
import { inventorySchema, inventoryUpdateSchema } from "@/lib/validation";
import { withSerializableRetry } from "@/lib/transactions";
import { emitAdminEvent } from "@/lib/realtime";
import { rateLimitApi, readJsonBody, rejectCrossSiteMutation, rejectOversizedBody, requireJsonContentType, withNoStore, InvalidJsonError, RequestBodyTooLargeError } from "@/lib/security";

/**
 * Inventory is read by staff and written by admins.
 *
 * `AuthUser.role` is the `RoleKey` enum itself, not a Prisma `Role` row. That
 * distinction matters: `requireApiAdmin()` has already refused anybody else, so
 * reaching for `user.role.key` here is the mistake that produces
 *
 *   Property 'key' does not exist on type 'RoleKey'.
 *     Property 'key' does not exist on type '"SUPER_ADMIN"'.
 *
 * The `role: RoleKey` annotation below makes the enum-ness explicit, so the
 * correct comparison reads as intentional and the wrong one fails at compile
 * time rather than looking plausible.
 */

type InventoryValues = {
  name: string;
  category: InventoryCategory;
  totalQuantity: number;
  bookedQuantity: number;
  reorderLevel: number;
  imageUrl?: string;
  imagePublicId?: string;
};

/** Raised inside a transaction for a condition the caller must be told about. */
class InventoryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function buildInventoryValues(data: InventoryValues) {
  const bookedQuantity = Math.min(data.bookedQuantity, data.totalQuantity);
  return {
    name: data.name.trim(),
    slug: slugify(data.name),
    category: data.category,
    totalQuantity: data.totalQuantity,
    bookedQuantity,
    availableQuantity: data.totalQuantity - bookedQuantity,
    reorderLevel: data.reorderLevel,
    imageUrl: data.imageUrl || null,
    imagePublicId: data.imagePublicId || null,
  };
}

export async function GET(request: Request) {
  const limited = rateLimitApi(request, "inventory-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  try {
    // Reading stock levels is limited to approved admins and approved staff.
    await requireApiStaff();
    const inventory = await prisma.inventory.findMany({ orderBy: [{ availableQuantity: "asc" }, { name: "asc" }] });
    return withNoStore(NextResponse.json({ inventory }));
  } catch (error) {
    return handleInventoryError(error, "Unable to load inventory.");
  }
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 32 * 1024);
  if (oversized) return oversized;
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  try {
    const caller: AuthUser = await requireApiAdmin();
    const role: RoleKey = caller.role;
    const limited = rateLimitApi(request, "inventory-write", { limit: 60, windowMs: 60_000, keySuffix: caller.id });
    if (limited) return limited;
    // The guard has already refused every role but an administrator's, so this is
    // a fail-closed assertion rather than a branch: an unauthenticated caller can
    // never reach the write, even if the guard above is ever weakened.
    if (role !== RoleKey.SUPER_ADMIN && role !== RoleKey.ADMIN) {
      return withNoStore(NextResponse.json({ error: "You are not authorized to change inventory." }, { status: 403 }));
    }

    const data = inventorySchema.parse(await readJsonBody(request, 32 * 1024));
    const values = buildInventoryValues({ ...data, bookedQuantity: 0 });
    const existing = await prisma.inventory.findFirst({ where: { OR: [{ name: values.name }, { slug: values.slug }] } });
    if (existing) return withNoStore(NextResponse.json({ error: "Inventory item with this name already exists." }, { status: 409 }));
    const inventory = await prisma.inventory.create({ data: values });
    emitAdminEvent("inventory.updated", { entityId: inventory.id, action: "created" });
    return withNoStore(NextResponse.json({ inventory }, { status: 201 }));
  } catch (error) {
    return handleInventoryError(error, "Unable to create inventory item.");
  }
}

export async function PUT(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 32 * 1024);
  if (oversized) return oversized;
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  try {
    const caller: AuthUser = await requireApiAdmin();
    const role: RoleKey = caller.role;
    const limited = rateLimitApi(request, "inventory-write", { limit: 60, windowMs: 60_000, keySuffix: caller.id });
    if (limited) return limited;
    if (role !== RoleKey.SUPER_ADMIN && role !== RoleKey.ADMIN) {
      return withNoStore(NextResponse.json({ error: "You are not authorized to change inventory." }, { status: 403 }));
    }

    const data = inventoryUpdateSchema.parse(await readJsonBody(request, 32 * 1024));
    const inventory = await withSerializableRetry(async (tx) => {
      const existingInventory = await tx.inventory.findUnique({ where: { id: data.id } });
      if (!existingInventory) throw new InventoryError(404, "That inventory item no longer exists.");
      const allocations = await tx.bookingInventory.aggregate({ where: { inventoryId: data.id }, _sum: { quantity: true } });
      const reservedQuantity = allocations._sum.quantity ?? 0;
      if (data.totalQuantity < reservedQuantity) throw new InventoryError(409, `Total quantity cannot be lower than ${reservedQuantity} reserved units.`);
      const values = { ...buildInventoryValues(data), bookedQuantity: reservedQuantity, availableQuantity: data.totalQuantity - reservedQuantity };
      const duplicate = await tx.inventory.findFirst({ where: { id: { not: data.id }, OR: [{ name: values.name }, { slug: values.slug }] } });
      if (duplicate) throw new InventoryError(409, "Another inventory item already uses this name.");
      return tx.inventory.update({ where: { id: data.id }, data: values });
    });
    emitAdminEvent("inventory.updated", { entityId: inventory.id, action: "updated" });
    return withNoStore(NextResponse.json({ inventory }));
  } catch (error) {
    return handleInventoryError(error, "Unable to update inventory item.");
  }
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limited = rateLimitApi(request, "inventory-delete", { limit: 30, windowMs: 60 * 60_000 });
  if (limited) return limited;
  try {
    await requireApiAdmin();
    const id = new URL(request.url).searchParams.get("id");
    if (!id || id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(id)) return withNoStore(NextResponse.json({ error: "Inventory item id is required." }, { status: 400 }));
    await withSerializableRetry(async (tx) => {
      const item = await tx.inventory.findUnique({ where: { id }, select: { id: true, bookedQuantity: true, _count: { select: { bookingInventory: true } } } });
      if (!item) throw new InventoryError(404, "That inventory item no longer exists.");
      if (item._count.bookingInventory > 0 || item.bookedQuantity > 0) throw new InventoryError(409, "Inventory with booking allocations cannot be deleted. Archive it instead.");
      await tx.inventory.delete({ where: { id } });
    });
    emitAdminEvent("inventory.updated", { entityId: id, action: "deleted" });
    return withNoStore(NextResponse.json({ success: true }));
  } catch (error) {
    return handleInventoryError(error, "Unable to delete inventory item.");
  }
}

/**
 * One mapping for every failure mode, so a caller can tell the difference between
 * "you are not allowed" (401/403), "that is not valid" (400/415/413), "it
 * conflicts" (409), "it is gone" (404) and "we broke" (500). Collapsing all of
 * those into a single 400 makes a genuine outage indistinguishable from a typo.
 */
function handleInventoryError(error: unknown, fallbackMessage: string) {
  if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  if (error instanceof InvalidJsonError) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  if (error instanceof InventoryError) return withNoStore(NextResponse.json({ error: error.message }, { status: error.status }));
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path.filter((part): part is string => typeof part === "string").at(0);
    return withNoStore(NextResponse.json({ error: first?.message ?? "Check the submitted fields.", field }, { status: 400 }));
  }
  // Authorization failures are mapped to 401/403 with no internal detail.
  const denied = accessDenied(error, fallbackMessage);
  if (denied.status === 400) {
    // `accessDenied` answers 400 for anything it does not recognise, which is
    // right for its callers but wrong here: an unmapped server fault is a 500,
    // not a bad request.
    console.error(`[inventory] ${fallbackMessage}`, error);
    return withNoStore(NextResponse.json({ error: fallbackMessage }, { status: 500 }));
  }
  return denied;
}