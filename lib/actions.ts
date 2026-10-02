"use server";

import { createHash } from "node:crypto";
import { AccountStatus, BookingStatus, NotificationType, PaymentMethod, PaymentStage, PricingMode, RoleKey, StaffStatus, StaffType } from "@prisma/client";
import { ZodError } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { toFriendlyError } from "@/lib/errors";
import { notifyAdmins, notifyUser } from "@/lib/notifications";
import { getCurrentUser, requireAdmin, requireCustomer, requireStaff, requestIp } from "@/lib/rbac";
import { approveAccessRequest, inviteTeamMember, rejectAccessRequest, resendTeamInvite, submitAccessRequest } from "@/lib/auth/team";
import {
  approveAccountAccess,
  changeUserRole,
  rejectAccountAccess,
  setAccountActive,
} from "@/lib/access-management";
import { recordSecurityEvent } from "@/lib/security-audit";
import {
  sendAccessApprovedEmail,
  sendAccessDeclinedEmail,
  sendStaffActivatedEmail,
} from "@/lib/mailer";
import {
  createBookingForPublicCustomer,
  createEvent,
  createPayment,
  ensureInvoice,
  updateBookingStatus,
} from "@/lib/bookings";
import { emitAdminEvent } from "@/lib/realtime";
import { assertCloudinaryAssetPair, deleteCloudinaryImage } from "@/lib/cloudinary";
import { withSerializableRetry } from "@/lib/transactions";
import { slugify } from "@/lib/utils";
import { allowRequest, getClientIp } from "@/lib/rate-limit";
import {
  bookingSchema,
  eventSchema,
  packageSchema,
  packageUpdateSchema,
  serviceSchema,
  serviceUpdateSchema,
  staffSchema,
  staffUpdateSchema,
  adminRequestSchema,
  businessSettingsSchema,
} from "@/lib/validation";

function publicBookingError(error: unknown) {
  if (error instanceof ZodError) return toFriendlyError(error);
  if (error instanceof Error && ["Event date must", "One or more selected services", "The selected package", "Choose a package", "Please enter", "valid date", "guest", "location", "incoming"].some((fragment) => error.message.toLowerCase().includes(fragment.toLowerCase()))) return error.message;
  return "We could not create the booking right now. Please try again.";
}

export type ActionState = {
  success: string | null;
  error: string | null;
  bookingId?: string;
  publicToken?: string;
};

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key).trim();
  return value || undefined;
}

function getNumber(formData: FormData, key: string) {
  const raw = getString(formData, key).trim();
  if (!raw) throw new Error(`${key} is required.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a valid number.`);
  return value;
}

function getBoolean(formData: FormData, key: string) {
  const value = formData.get(key);
  if (value === "true" || value === "on") return true;
  if (value === "false" || value === "off") return false;
  throw new Error(`${key} is required.`);
}

function parseServices(value: string) {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function messageFromError(error: unknown) {
  return toFriendlyError(error);
}

function formDataObject(formData: FormData, keys: string[]) {
  return Object.fromEntries(
    keys.map((key) => [key, getString(formData, key)]),
  );
}

async function enforceActionRateLimit(scope: string, key: string, limit = 30, windowMs = 10 * 60_000) {
  const requestHeaders = await headers();
  const ip = getClientIp({ headers: requestHeaders });
  const userKey = createHash("sha256").update(key).digest("hex");
  if (!allowRequest(`action:${scope}:user:${userKey}`, limit, windowMs) || !allowRequest(`action:${scope}:ip:${ip}`, Math.max(limit * 2, limit), windowMs)) throw new Error("Too many requests. Please try again later.");
}

export async function createBookingAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const requestHeaders = await headers();
    const ip = getClientIp({ headers: requestHeaders });
    if (!allowRequest(`booking-action:${ip}`, 5, 10 * 60_000)) return { success: null, error: "Too many booking requests. Please try again later." };
    const raw = {
      customerName: getString(formData, "customerName"),
      customerEmail: getString(formData, "customerEmail"),
      customerPhone: getString(formData, "customerPhone"),
      eventType: getString(formData, "eventType"),
      eventDate: getString(formData, "eventDate"),
      location: getString(formData, "location"),
      guestCount: getNumber(formData, "guestCount"),
      packageId: getOptionalString(formData, "packageId"),
      notes: getString(formData, "notes"),
      idempotencyKey: getOptionalString(formData, "idempotencyKey"),
      services: parseServices(getString(formData, "services")),
    };
    const data = bookingSchema.parse(raw);
    const booking = await createBookingForPublicCustomer(data);
    revalidatePath("/admin/bookings");
    revalidatePath("/customer/dashboard");
    return {
      success: "Your booking request has been received. Our team will contact you shortly.",
      error: null,
      bookingId: booking.id,
      publicToken: booking.publicToken ?? undefined,
    };
  } catch (error) {
    return { success: null, error: publicBookingError(error) };
  }
}

export async function updateBookingStatusAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    await enforceActionRateLimit("booking-status", bookingId, 30, 60_000);
    const status = getString(formData, "status") as BookingStatus;
    if (!Object.values(BookingStatus).includes(status)) throw new Error("Invalid booking status.");
    await updateBookingStatus(bookingId, status);
    revalidatePath("/admin");
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/customer/dashboard");
    return { success: `Booking moved to ${status.toLowerCase()}.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function recordPaymentAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    await enforceActionRateLimit("payment", bookingId, 30, 60_000);
    const payment = await createPayment({
      bookingId,
      amount: getNumber(formData, "amount"),
      stage: getString(formData, "stage") as PaymentStage,
      method: getString(formData, "method") as PaymentMethod,
      reference: getOptionalString(formData, "reference"),
      idempotencyKey: getOptionalString(formData, "idempotencyKey"),
    });
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/payments");
    revalidatePath("/admin/invoices");
    revalidatePath("/customer/dashboard");
    return { success: "Payment recorded successfully.", error: null, bookingId: payment.bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function createInvoiceAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    await enforceActionRateLimit("invoice", bookingId, 20, 60_000);
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
    if (!booking || booking.status === BookingStatus.PENDING) throw new Error("Approve the booking before generating an invoice.");
    await ensureInvoice(bookingId);
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/invoices");
    return { success: "Invoice generated successfully.", error: null, bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function deleteEventAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    await enforceActionRateLimit("event-delete", bookingId, 20, 60_000);
    await prisma.event.delete({ where: { bookingId } });
    revalidatePath("/admin/events");
    revalidatePath("/admin/calendar");
    revalidatePath(`/admin/bookings/${bookingId}`);
    emitAdminEvent("booking.updated", { entityId: bookingId, action: "event-deleted" });
    return { success: "Calendar event unlinked.", error: null, bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function createEventAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("event-create", getString(formData, "bookingId"), 20, 60_000);
    const raw = formDataObject(formData, ["bookingId", "title", "startDate", "endDate", "location"]);
    const data = eventSchema.parse(raw);
    await createEvent(data);
    revalidatePath("/admin/events");
    revalidatePath("/admin/calendar");
    revalidatePath(`/admin/bookings/${data.bookingId}`);
    return { success: "Event calendar record saved.", error: null, bookingId: data.bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function createInventoryAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("inventory-create", getString(formData, "name"), 30, 60_000);
    const raw = {
      name: getString(formData, "name"),
      category: getString(formData, "category"),
      totalQuantity: getNumber(formData, "totalQuantity"),
      bookedQuantity: 0,
      reorderLevel: getNumber(formData, "reorderLevel"),
      imageUrl: getString(formData, "imageUrl"),
      imagePublicId: getString(formData, "imagePublicId"),
    };
    const data = (await import("@/lib/validation")).inventorySchema.parse(raw);
    assertCloudinaryAssetPair(data.imageUrl || null, data.imagePublicId || null);
    const item = await prisma.inventory.create({
      data: {
        name: data.name,
        slug: slugify(data.name),
        category: data.category,
        totalQuantity: data.totalQuantity,
        bookedQuantity: 0,
        availableQuantity: data.totalQuantity,
        reorderLevel: data.reorderLevel,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
      },
    });
    revalidatePath("/admin/inventory");
    emitAdminEvent("inventory.updated", { entityId: item.id, action: "created" });
    return { success: `${item.name} added to inventory.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function updateInventoryAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("inventory-update", getString(formData, "id"), 30, 60_000);
    const raw = {
      id: getString(formData, "id"),
      name: getString(formData, "name"),
      category: getString(formData, "category"),
      totalQuantity: getNumber(formData, "totalQuantity"),
      bookedQuantity: 0,
      reorderLevel: getNumber(formData, "reorderLevel"),
      imageUrl: getString(formData, "imageUrl"),
      imagePublicId: getString(formData, "imagePublicId"),
    };
    const data = (await import("@/lib/validation")).inventoryUpdateSchema.parse(raw);
    assertCloudinaryAssetPair(data.imageUrl || null, data.imagePublicId || null);
    const current = await withSerializableRetry(async (tx) => {
      const existing = await tx.inventory.findUniqueOrThrow({ where: { id: data.id }, select: { id: true, imagePublicId: true } });
      const allocations = await tx.bookingInventory.aggregate({
        where: { inventoryId: data.id },
        _sum: { quantity: true },
      });
      const reservedQuantity = allocations._sum.quantity ?? 0;
      if (data.totalQuantity < reservedQuantity) {
        throw new Error(`Total quantity cannot be lower than the ${reservedQuantity} unit(s) already reserved.`);
      }
      const updated = await tx.inventory.update({
        where: { id: data.id },
        data: {
          name: data.name,
          slug: slugify(data.name),
          category: data.category,
          totalQuantity: data.totalQuantity,
          bookedQuantity: reservedQuantity,
          availableQuantity: data.totalQuantity - reservedQuantity,
          reorderLevel: data.reorderLevel,
          imageUrl: data.imageUrl || null,
          imagePublicId: data.imagePublicId || null,
        },
        select: { id: true, imagePublicId: true },
      });
      return { id: updated.id, oldPublicId: existing.imagePublicId };
    });
    if (current.oldPublicId && current.oldPublicId !== data.imagePublicId) await deleteCloudinaryImage(current.oldPublicId);
    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/bookings/${current.id}`);
    emitAdminEvent("inventory.updated", { entityId: current.id, action: "updated" });
    return { success: "Inventory item updated.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function createPackageAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("package-create", getString(formData, "name"), 20, 60_000);
    const raw = {
      name: getString(formData, "name"),
      description: getString(formData, "description"),
      price: getNumber(formData, "price"),
      imageUrl: getString(formData, "imageUrl"),
      imagePublicId: getString(formData, "imagePublicId"),
      serviceIds: formData.getAll("serviceIds").map(String),
    };
    const data = packageSchema.parse(raw);
    assertCloudinaryAssetPair(data.imageUrl || null, data.imagePublicId || null);
    const activeServiceIds = Array.from(new Set(data.serviceIds));
    const activeServices = await prisma.service.count({ where: { id: { in: activeServiceIds }, isActive: true } });
    if (activeServices !== activeServiceIds.length) throw new Error("One or more selected services are archived or unavailable.");
    const pkg = await prisma.package.create({
      data: {
        name: data.name,
        slug: slugify(data.name),
        description: data.description,
        price: data.price,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
        packageServices: { create: activeServiceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    revalidatePath("/admin/packages");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: pkg.id, action: "package-created" });
    return { success: `${pkg.name} created.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function updatePackageAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("package-update", getString(formData, "id"), 20, 60_000);
    const data = packageUpdateSchema.parse({
      id: getString(formData, "id"),
      name: getString(formData, "name"),
      description: getString(formData, "description"),
      price: getNumber(formData, "price"),
      imageUrl: getString(formData, "imageUrl"),
      imagePublicId: getString(formData, "imagePublicId"),
      serviceIds: formData.getAll("serviceIds").map(String),
    });
    assertCloudinaryAssetPair(data.imageUrl || null, data.imagePublicId || null);
    const activeServiceIds = Array.from(new Set(data.serviceIds));
    const activeServices = await prisma.service.count({ where: { id: { in: activeServiceIds }, isActive: true } });
    if (activeServices !== activeServiceIds.length) throw new Error("One or more selected services are archived or unavailable.");
    const previous = await prisma.package.findUnique({ where: { id: data.id }, select: { imagePublicId: true, slug: true } });
    const pkg = await prisma.package.update({
      where: { id: data.id },
      data: {
        name: data.name,
        slug: previous?.slug ?? slugify(data.name),
        description: data.description,
        price: data.price,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
        packageServices: {
          deleteMany: {},
          create: activeServiceIds.map((serviceId) => ({ serviceId })),
        },
      },
    });
    if (previous?.imagePublicId && previous.imagePublicId !== data.imagePublicId) await deleteCloudinaryImage(previous.imagePublicId);
    revalidatePath("/admin/packages");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: pkg.id, action: "package-updated" });
    return { success: `${pkg.name} updated.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function createServiceAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("service-create", getString(formData, "name"), 20, 60_000);
    const data = serviceSchema.parse({
      name: getString(formData, "name"),
      description: getString(formData, "description"),
      basePrice: getNumber(formData, "basePrice"),
      unitLabel: getString(formData, "unitLabel") || "unit",
      pricingMode: getString(formData, "pricingMode") || PricingMode.FIXED,
      inventoryCategory: getOptionalString(formData, "inventoryCategory") || null,
      imageUrl: getString(formData, "imageUrl"),
      imagePublicId: getString(formData, "imagePublicId"),
    });
    assertCloudinaryAssetPair(data.imageUrl || null, data.imagePublicId || null);
    const service = await prisma.service.create({
      data: {
        name: data.name,
        slug: slugify(data.name),
        description: data.description || null,
        basePrice: data.basePrice,
        unitLabel: data.unitLabel,
        pricingMode: data.pricingMode,
        inventoryCategory: data.inventoryCategory ?? null,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
      },
    });
    revalidatePath("/admin/services");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: service.id, action: "service-created" });
    return { success: `${service.name} added to the service catalog.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function updateServiceAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("service-update", getString(formData, "id"), 20, 60_000);
    const data = serviceUpdateSchema.parse({
      id: getString(formData, "id"),
      name: getString(formData, "name"),
      description: getString(formData, "description"),
      basePrice: getNumber(formData, "basePrice"),
      unitLabel: getString(formData, "unitLabel") || "unit",
      pricingMode: getString(formData, "pricingMode") || PricingMode.FIXED,
      inventoryCategory: getOptionalString(formData, "inventoryCategory") || null,
      imageUrl: getString(formData, "imageUrl"),
      imagePublicId: getString(formData, "imagePublicId"),
    });
    assertCloudinaryAssetPair(data.imageUrl || null, data.imagePublicId || null);
    const previous = await prisma.service.findUnique({ where: { id: data.id }, select: { imagePublicId: true, slug: true } });
    const service = await prisma.service.update({
      where: { id: data.id },
      data: {
        name: data.name,
        slug: previous?.slug ?? slugify(data.name),
        description: data.description || null,
        basePrice: data.basePrice,
        unitLabel: data.unitLabel,
        pricingMode: data.pricingMode,
        inventoryCategory: data.inventoryCategory ?? null,
        imageUrl: data.imageUrl || null,
        imagePublicId: data.imagePublicId || null,
      },
    });
    if (previous?.imagePublicId && previous.imagePublicId !== data.imagePublicId) await deleteCloudinaryImage(previous.imagePublicId);
    revalidatePath("/admin/services");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: service.id, action: "service-updated" });
    return { success: `${service.name} updated.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function setServiceActiveAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    const isActive = getBoolean(formData, "isActive");
    await enforceActionRateLimit("service-archive", id, 20, 60_000);
    const service = await prisma.service.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/services");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: service.id, action: isActive ? "service-restored" : "service-archived" });
    return { success: `${service.name} ${isActive ? "restored" : "archived"}.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function deleteServiceAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    await enforceActionRateLimit("service-delete", id, 10, 60_000);
    const result = await withSerializableRetry(async (tx) => {
      const service = await tx.service.findUnique({ where: { id }, select: { id: true, name: true, imagePublicId: true, _count: { select: { bookingServices: true, packageServices: true } } } });
      if (!service) throw new Error("Service not found.");
      if (service._count.bookingServices > 0 || service._count.packageServices > 0) {
        throw new Error("This service is used by a package or booking. Archive it instead of deleting it.");
      }
      await tx.service.delete({ where: { id } });
      return service;
    });
    await deleteCloudinaryImage(result.imagePublicId);
    revalidatePath("/admin/services");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: id, action: "service-deleted" });
    return { success: `${result.name} deleted.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function setPackageActiveAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    const isActive = getBoolean(formData, "isActive");
    await enforceActionRateLimit("package-archive", id, 20, 60_000);
    const pkg = await prisma.package.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/packages");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: pkg.id, action: isActive ? "package-restored" : "package-archived" });
    return { success: `${pkg.name} ${isActive ? "restored" : "archived"}.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function deletePackageAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    await enforceActionRateLimit("package-delete", id, 10, 60_000);
    const result = await withSerializableRetry(async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id }, select: { id: true, name: true, imagePublicId: true, _count: { select: { bookings: true } } } });
      if (!pkg) throw new Error("Package not found.");
      if (pkg._count.bookings > 0) throw new Error("This package is used by a booking. Archive it instead of deleting it.");
      await tx.package.delete({ where: { id } });
      return pkg;
    });
    await deleteCloudinaryImage(result.imagePublicId);
    revalidatePath("/admin/packages");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    emitAdminEvent("catalog.updated", { entityId: id, action: "package-deleted" });
    return { success: `${result.name} deleted.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function setInventoryActiveAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    const isActive = getBoolean(formData, "isActive");
    await enforceActionRateLimit("inventory-archive", id, 20, 60_000);
    const item = await prisma.inventory.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/inventory");
    emitAdminEvent("inventory.updated", { entityId: item.id, action: isActive ? "restored" : "archived" });
    return { success: `${item.name} ${isActive ? "restored" : "archived"}.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function deleteInventoryAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    await enforceActionRateLimit("inventory-delete", id, 10, 60_000);
    const result = await withSerializableRetry(async (tx) => {
      const item = await tx.inventory.findUnique({ where: { id }, select: { id: true, name: true, bookedQuantity: true, imagePublicId: true, _count: { select: { bookingInventory: true } } } });
      if (!item) throw new Error("Inventory item not found.");
      if (item._count.bookingInventory > 0 || item.bookedQuantity > 0) {
        throw new Error("This inventory item is reserved by a booking. Archive it instead of deleting it.");
      }
      await tx.inventory.delete({ where: { id } });
      return item;
    });
    await deleteCloudinaryImage(result.imagePublicId);
    revalidatePath("/admin/inventory");
    emitAdminEvent("inventory.updated", { entityId: id, action: "deleted" });
    return { success: `${result.name} deleted.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function createStaffAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireAdmin();
    await enforceActionRateLimit("staff-create", getString(formData, "email"), 10, 60 * 60_000);
    const data = staffSchema.parse({
      firstName: getString(formData, "firstName"),
      lastName: getString(formData, "lastName"),
      email: getString(formData, "email"),
      staffType: getString(formData, "staffType") as StaffType,
    });
    // Delegates to the shared team service so the activation-token flow, audit
    // entries, and profile creation stay identical to the request path.
    const result = await inviteTeamMember({
      reviewer: { id: reviewer.id, role: reviewer.role, firstName: reviewer.firstName, lastName: reviewer.lastName },
      fullName: `${data.firstName}${data.lastName ? ` ${data.lastName}` : ""}`,
      email: data.email,
      role: "STAFF",
      staffType: data.staffType,
      ipAddress: await requestIp(),
    });
    if (!result.ok) throw new Error(result.message);
    await notifyUser(result.userId, {
      type: NotificationType.STAFF_INVITE,
      title: "Staff invitation sent",
      message: `Your staff account for ${process.env.MAIL_FROM_NAME || "this business"} was created. Activate it to view your assignments.`,
      href: "/staff",
    });
    revalidatePath("/admin/staff");
    revalidatePath("/admin/notifications");
    emitAdminEvent("staff.updated", { entityId: result.userId, action: "invited" });
    return {
      success: result.activationUrl
        ? `Staff account created for ${result.email}, but the mailer is not configured. Share this activation link manually: ${result.activationUrl}`
        : `Invitation sent to ${result.email}. They appear as pending until they activate their account.`,
      error: null,
    };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function resendStaffInviteAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    await enforceActionRateLimit("staff-invite-resend", id, 20, 60_000);
    const staff = await prisma.staff.findUnique({ where: { id }, select: { id: true, status: true, userId: true } });
    if (!staff) throw new Error("Staff member not found.");
    if (staff.status === StaffStatus.ACTIVE) throw new Error("This staff member is already active.");
    const result = await resendTeamInvite(staff.userId);
    if (!result.ok) throw new Error(result.message);
    revalidatePath("/admin/staff");
    return { success: result.activationUrl ? `${result.message}\n\nActivation link: ${result.activationUrl}` : result.message, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function acceptStaffInviteAction(formData: FormData): Promise<ActionState> {
  try {
    const token = getString(formData, "token").trim();
    if (!token) throw new Error("This invitation link is invalid.");
    const staff = await prisma.staff.findUnique({ where: { inviteToken: token }, include: { user: true } });
    if (!staff) throw new Error("This invitation link is invalid or has already been used.");
    if (staff.status === StaffStatus.ACTIVE) return { success: "Your staff account is already active.", error: null };
    if (staff.inviteExpiresAt && staff.inviteExpiresAt.getTime() < Date.now()) {
      throw new Error("This invitation has expired. Ask an administrator to resend it.");
    }
    const current = await getCurrentUser();
    if (!current) throw new Error("Please sign in or create your account to activate this invitation.");
    // Matched on the signed-in identity, never on the email field, so opening
    // somebody else's invite link cannot activate this account.
    if (current.id !== staff.userId) {
      throw new Error(`This invitation was sent to ${staff.user.email}. Sign in with that email address.`);
    }
    if (current.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error("This account is suspended. Contact an administrator.");
    }
    // Opening the emailed link is the final approval step for an invited
    // staff member, so the account leaves PENDING_APPROVAL here.
    await withSerializableRetry(async (tx) => {
      const claimed = await tx.staff.updateMany({
        where: { id: staff.id, status: StaffStatus.PENDING },
        data: { status: StaffStatus.ACTIVE, activatedAt: new Date(), inviteToken: null, inviteExpiresAt: null },
      });
      if (claimed.count !== 1) throw new Error("This invitation has already been used.");
      await tx.user.update({
        where: { id: staff.userId },
        data: { isActive: true, accountStatus: AccountStatus.ACTIVE, approvedAt: new Date(), suspendedAt: null, suspensionReason: null },
      });
    });
    await recordSecurityEvent({ type: "ACCOUNT_APPROVED", userId: staff.userId, email: staff.user.email, detail: "Staff invitation accepted; account activated." });
    await sendStaffActivatedEmail({ to: staff.user.email, firstName: staff.user.firstName, staffType: staff.staffType });
    await notifyAdmins({
      type: NotificationType.STAFF_ACTIVATED,
      title: "Staff member activated",
      message: `${staff.user.firstName} ${staff.user.lastName ?? ""}`.trim() + ` activated their ${staff.staffType.toLowerCase().replaceAll("_", " ")} account.`,
      href: "/admin/staff",
    });
    revalidatePath("/admin/staff");
    revalidatePath("/staff");
    revalidatePath("/admin/security");
    return { success: "Your staff account is active. Welcome to the team!", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function updateStaffAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("staff-update", getString(formData, "id"), 30, 60_000);
    const data = staffUpdateSchema.parse({
      id: getString(formData, "id"),
      isAvailable: getBoolean(formData, "isAvailable"),
    });
    const existing = await prisma.staff.findUnique({ where: { id: data.id }, select: { status: true } });
    if (!existing) throw new Error("Staff member not found.");
    if (existing.status !== StaffStatus.ACTIVE) throw new Error("Only active staff can change availability.");
    await prisma.staff.update({ where: { id: data.id }, data: { isAvailable: data.isAvailable } });
    revalidatePath("/admin/staff");
    emitAdminEvent("staff.updated", { entityId: data.id, action: "availability-updated" });
    return { success: "Staff availability updated.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function removeStaffAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = getString(formData, "id");
    await enforceActionRateLimit("staff-delete", id, 20, 60_000);
    const result = await withSerializableRetry(async (tx) => {
      const member = await tx.staff.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              firstName: true,
              customerProfile: { select: { id: true } },
              adminProfile: { select: { id: true } },
            },
          },
          _count: { select: { assignments: true } },
        },
      });
      if (!member) throw new Error("Staff member not found.");
      if (member._count.assignments > 0) {
        throw new Error("Remove this staff member from all assigned events before deleting them.");
      }
      if (member.user.adminProfile) {
        throw new Error("This person is also an administrator. Remove their admin role instead.");
      }
      const customerRole = await tx.role.findUniqueOrThrow({ where: { key: RoleKey.CUSTOMER } });
      await tx.staff.delete({ where: { id } });
      // Demoting to customer keeps the existing approval, because the admin
      // already decided this person may use the system; only the role changes.
      await tx.user.update({ where: { id: member.userId }, data: { roleId: customerRole.id } });
      if (!member.user.customerProfile) {
        await tx.customer.create({ data: { userId: member.userId } });
      }
      return { firstName: member.user.firstName, userId: member.userId, previousRole: RoleKey.STAFF };
    });
    await recordSecurityEvent({ type: "ROLE_CHANGED", userId: result.userId, detail: `Staff member removed and demoted to customer.` });
    revalidatePath("/admin/staff");
    revalidatePath("/admin/security");
    revalidatePath("/staff");
    revalidatePath("/admin/bookings");
    emitAdminEvent("staff.updated", { entityId: id, action: "removed" });
    return { success: `${result.firstName} was removed from the staff team.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function assignStaffAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    const staffId = getString(formData, "staffId");
    if (!bookingId || !staffId) throw new Error("Choose a booking and staff member.");
    await enforceActionRateLimit("staff-assignment", bookingId, 30, 60_000);
    await withSerializableRetry(async (tx) => {
      const [staff, booking] = await Promise.all([
        tx.staff.findUnique({ where: { id: staffId } }),
        tx.booking.findUnique({ where: { id: bookingId } }),
      ]);
      if (!staff || !booking) throw new Error("Booking or staff member not found.");
      if (staff.status !== StaffStatus.ACTIVE) throw new Error("That staff member has not activated their account yet.");
      const assignableStatuses: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.PREPARING];
      if (!assignableStatuses.includes(booking.status)) throw new Error("Staff can only be assigned to active bookings.");
      if (!staff.isAvailable) throw new Error("That staff member is currently unavailable.");
      const conflict = await tx.bookingStaff.findFirst({
        where: {
          staffId,
          bookingId: { not: bookingId },
          booking: {
            eventDate: { gte: new Date(booking.eventDate.getTime() - 12 * 60 * 60 * 1000), lte: new Date(booking.eventDate.getTime() + 12 * 60 * 60 * 1000) },
            status: { in: ["APPROVED", "PREPARING"] },
          },
        },
      });
      if (conflict) throw new Error("That staff member is already assigned to an event on this date.");
      await tx.bookingStaff.upsert({ where: { bookingId_staffId: { bookingId, staffId } }, update: {}, create: { bookingId, staffId } });
    });
    emitAdminEvent("staff.updated", { entityId: staffId, action: "assigned" });
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/staff");
    return { success: "Staff member assigned to the booking.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function updateOwnAvailabilityAction(formData: FormData): Promise<ActionState> {
  try {
    // `requireStaff` already enforces identity, approval, and MFA server-side.
    const current = await requireStaff();
    await enforceActionRateLimit("staff-own-availability", current.id, 30, 60_000);
    if (!current.staffProfile) throw new Error("Staff profile not found.");
    await prisma.staff.update({
      where: { id: current.staffProfile.id },
      data: { isAvailable: getBoolean(formData, "isAvailable") },
    });
    revalidatePath("/staff");
    revalidatePath("/admin/staff");
    return { success: "Availability updated.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function unassignStaffAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    const assignmentId = getString(formData, "assignmentId");
    if (!bookingId || !assignmentId) throw new Error("Missing staff assignment.");
    await enforceActionRateLimit("staff-unassignment", bookingId, 30, 60_000);
    const removed = await prisma.bookingStaff.deleteMany({ where: { id: assignmentId, bookingId } });
    if (removed.count !== 1) throw new Error("That staff assignment is no longer available.");
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/staff");
    emitAdminEvent("staff.updated", { entityId: assignmentId, action: "unassigned" });
    return { success: "Staff member unassigned.", error: null, bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function cancelBookingAction(formData: FormData): Promise<ActionState> {
  try {
    const current = await requireCustomer();
    await enforceActionRateLimit("booking-cancel", current.id, 10, 60_000);
    const bookingId = getString(formData, "bookingId");
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !current.customerProfile || booking.customerId !== current.customerProfile.id) throw new Error("You cannot cancel this booking.");
    if (Number(booking.paidAmount) > 0) throw new Error("Please contact the team to cancel a booking with a recorded payment.");
    await updateBookingStatus(bookingId, "CANCELLED");
    revalidatePath("/customer/dashboard");
    revalidatePath(`/customer/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");
    return { success: "Booking cancelled.", error: null, bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    await enforceActionRateLimit("notifications-read-all", admin.id, 30, 60_000);
    await prisma.notification.updateMany({ where: { userId: admin.id, audience: "ADMIN", read: false }, data: { read: true } });
    revalidatePath("/admin/notifications");
    return { success: "All notifications marked as read.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function markNotificationReadAction(formData: FormData): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const notificationId = getString(formData, "notificationId");
    await enforceActionRateLimit("notification-read", notificationId, 60, 60_000);
    const updated = await prisma.notification.updateMany({
      where: { id: notificationId, userId: admin.id, audience: "ADMIN" },
      data: { read: true },
    });
    if (updated.count !== 1) throw new Error("Notification not found.");
    revalidatePath("/admin/notifications");
    return { success: "Notification marked as read.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function updateUserActiveAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireAdmin();
    const userId = getString(formData, "userId");
    const isActive = getBoolean(formData, "isActive");
    await enforceActionRateLimit("user-active", userId, 20, 60_000);
    // Deactivation is implemented as a suspension, so the Clerk session alone
    // can never be enough to regain access.
    await setAccountActive({ reviewer: { id: reviewer.id, role: reviewer.role }, userId, isActive });
    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/notifications");
    return { success: isActive ? "Account reactivated." : "Account suspended.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/** Approves a pending/blocked account so it can use the workspace. */
export async function approveUserAccessAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireAdmin();
    const userId = getString(formData, "userId");
    if (!userId) throw new Error("Missing account.");
    await enforceActionRateLimit("account-approve", userId, 20, 60_000);
    const result = await approveAccountAccess({
      reviewer: { id: reviewer.id, role: reviewer.role },
      userId,
      reason: getOptionalString(formData, "reason") ?? null,
    });
    const target = await prisma.user.findUnique({ where: { id: result.userId }, select: { email: true, firstName: true } });
    if (target) {
      await sendAccessApprovedEmail({ to: target.email, firstName: target.firstName });
      await notifyUser(result.userId, { type: NotificationType.STAFF_ACTIVATED, title: "Access approved", message: "An administrator approved your account. You can now continue into the system.", href: "/customer/dashboard" });
    }
    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/notifications");
    return { success: "Account approved. The user can now sign in and continue.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/** Rejects an account; it is denied access and kept out of the workspace. */
export async function rejectUserAccessAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireAdmin();
    const userId = getString(formData, "userId");
    if (!userId) throw new Error("Missing account.");
    await enforceActionRateLimit("account-reject", userId, 20, 60_000);
    const result = await rejectAccountAccess({
      reviewer: { id: reviewer.id, role: reviewer.role },
      userId,
      reason: getOptionalString(formData, "reason") ?? null,
    });
    const target = await prisma.user.findUnique({ where: { id: result.userId }, select: { email: true, firstName: true } });
    if (target) {
      await sendAccessDeclinedEmail({ to: target.email, firstName: target.firstName });
    }
    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/notifications");
    return { success: "Account rejected and access revoked.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/** Explicit privilege grant. Separated from approval on purpose. */
export async function changeUserRoleAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireAdmin();
    const userId = getString(formData, "userId");
    const rawRole = getString(formData, "role");
    const nextRole = Object.values(RoleKey).find((role) => role === rawRole);
    if (!userId || !nextRole) throw new Error("Choose a valid role.");
    await enforceActionRateLimit("user-role", userId, 20, 60_000);
    const requestedStaffType = getOptionalString(formData, "staffType");
    await changeUserRole({
      reviewer: { id: reviewer.id, role: reviewer.role },
      userId,
      nextRole,
      staffType: Object.values(StaffType).find((type) => type === requestedStaffType) ?? null,
    });
    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/staff");
    revalidatePath("/admin/notifications");
    return { success: `Role updated to ${nextRole.toLowerCase().replaceAll("_", " ")}.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function reviewAdminRequestAction(formData: FormData): Promise<ActionState> {
  try {
    const requestId = getString(formData, "requestId");
    const decision = getString(formData, "decision");
    if (decision !== "APPROVED" && decision !== "REJECTED") throw new Error("Invalid decision.");
    const reviewer = await requireAdmin();
    await enforceActionRateLimit("access-review", requestId, 20, 60_000);
    const requestedStaffType = getOptionalString(formData, "staffType");
    const approvedStaffType = Object.values(StaffType).find((type) => type === requestedStaffType);
    const ipAddress = await requestIp();

    // Delegates to the shared team service, which owns the approval rules and
    // issues the activation link. Nothing is provisioned until a super admin
    // (for ADMIN) or an admin (for STAFF) decides here.
    const outcome = decision === "APPROVED"
      ? await approveAccessRequest({
          requestId,
          reviewer: { id: reviewer.id, role: reviewer.role, firstName: reviewer.firstName, lastName: reviewer.lastName },
          staffType: approvedStaffType ?? null,
          reviewNote: getOptionalString(formData, "reviewNote") ?? null,
          ipAddress,
        })
      : await rejectAccessRequest({
          requestId,
          reviewer: { id: reviewer.id, role: reviewer.role },
          reviewNote: getOptionalString(formData, "reviewNote") ?? null,
          ipAddress,
        });

    if (!outcome.ok) throw new Error(outcome.message);

    revalidatePath("/admin/admins");
    revalidatePath("/admin/staff");
    revalidatePath("/admin/notifications");
    revalidatePath("/admin/security");
    revalidatePath("/staff");
    if (decision === "REJECTED") return { success: "Access request declined.", error: null };
    const roleLabel = approvedStaffType ? approvedStaffType.toLowerCase().replaceAll("_", " ") : "approved";
    const shared = "activationUrl" in outcome && outcome.activationUrl ? `\n\nActivation link: ${outcome.activationUrl}` : "";
    return { success: `Access request approved (${roleLabel}).${shared}`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function saveBusinessSettingsAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("business-settings", "default", 10, 60_000);
    const data = businessSettingsSchema.parse({
      businessName: getString(formData, "businessName"),
      email: getString(formData, "email"),
      phone: getString(formData, "phone"),
      address: getString(formData, "address"),
      city: getString(formData, "city"),
      taxRate: getNumber(formData, "taxRate"),
      currency: getString(formData, "currency"),
    });
    await prisma.businessSetting.upsert({
      where: { id: "default" },
      update: data,
      create: { id: "default", ...data },
    });
    revalidatePath("/admin/settings");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/contact");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    return { success: "Business settings saved.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/**
 * @deprecated Team access requests no longer require a sign-in. Use
 * `submitAccessRequestAction` in `@/lib/auth-actions`, which is the public
 * "join the team" form. Kept only so older links still resolve to it.
 */
export async function requestAdminAccessAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const data = adminRequestSchema.parse({
      firstName: getString(formData, "firstName"),
      lastName: getString(formData, "lastName"),
      email: getString(formData, "email"),
      requestedRole: getString(formData, "requestedRole"),
      note: getString(formData, "note"),
    });
    const signedIn = await getCurrentUser();
    const result = await submitAccessRequest({
      fullName: `${data.firstName}${data.lastName ? ` ${data.lastName}` : ""}`,
      email: data.email,
      requestedRole: data.requestedRole,
      note: data.note || null,
      requesterId: signedIn?.id ?? null,
      ipAddress: await requestIp(),
    });
    if (!result.ok) throw new Error(result.message);
    revalidatePath("/admin/admins");
    revalidatePath("/admin/notifications");
    return { success: "Your access request was sent for review.", error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}
