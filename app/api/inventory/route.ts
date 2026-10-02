import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied, requireApiAdmin, requireApiStaff } from "@/lib/route-guards";
import { slugify } from "@/lib/utils";
import { inventorySchema, inventoryUpdateSchema } from "@/lib/validation";
import { withSerializableRetry } from "@/lib/transactions";
import { emitAdminEvent } from "@/lib/realtime";
import { rateLimitApi, readJsonBody, rejectCrossSiteMutation, rejectOversizedBody, requireJsonContentType, withNoStore, InvalidJsonError, RequestBodyTooLargeError } from "@/lib/security";

function buildInventoryValues(data: { name: string; category: import("@prisma/client").InventoryCategory; totalQuantity: number; bookedQuantity: number; reorderLevel: number; imageUrl?: string; imagePublicId?: string }) {
  const bookedQuantity = Math.min(data.bookedQuantity, data.totalQuantity);
  return { name: data.name.trim(), slug: slugify(data.name), category: data.category, totalQuantity: data.totalQuantity, bookedQuantity, availableQuantity: data.totalQuantity - bookedQuantity, reorderLevel: data.reorderLevel, imageUrl: data.imageUrl || null, imagePublicId: data.imagePublicId || null };
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
    const user = await requireApiAdmin();
    const limited = rateLimitApi(request, "inventory-write", { limit: 60, windowMs: 60_000, keySuffix: user.id });
    if (limited) return limited;
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
    const user = await requireApiAdmin();
    const limited = rateLimitApi(request, "inventory-write", { limit: 60, windowMs: 60_000, keySuffix: user.id });
    if (limited) return limited;
    const data = inventoryUpdateSchema.parse(await readJsonBody(request, 32 * 1024));
    const inventory = await withSerializableRetry(async (tx) => {
      const existingInventory = await tx.inventory.findUnique({ where: { id: data.id } });
      if (!existingInventory) throw new Error("NOT_FOUND");
      const allocations = await tx.bookingInventory.aggregate({ where: { inventoryId: data.id }, _sum: { quantity: true } });
      const reservedQuantity = allocations._sum.quantity ?? 0;
      if (data.totalQuantity < reservedQuantity) throw new Error(`Total quantity cannot be lower than ${reservedQuantity} reserved units.`);
      const values = { ...buildInventoryValues(data), bookedQuantity: reservedQuantity, availableQuantity: data.totalQuantity - reservedQuantity };
      const duplicate = await tx.inventory.findFirst({ where: { id: { not: data.id }, OR: [{ name: values.name }, { slug: values.slug }] } });
      if (duplicate) throw new Error("Another inventory item already uses this name.");
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
      if (!item) throw new Error("NOT_FOUND");
      if (item._count.bookingInventory > 0 || item.bookedQuantity > 0) throw new Error("Inventory with booking allocations cannot be deleted. Archive it instead.");
      await tx.inventory.delete({ where: { id } });
    });
    emitAdminEvent("inventory.updated", { entityId: id, action: "deleted" });
    return withNoStore(NextResponse.json({ success: true }));
  } catch (error) {
    return handleInventoryError(error, "Unable to delete inventory item.");
  }
}

function handleInventoryError(error: unknown, fallbackMessage: string) {
  if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  if (error instanceof InvalidJsonError) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  // Authorization failures are mapped to 401/403 with no internal detail.
  const denied = accessDenied(error, fallbackMessage);
  return denied;
}
