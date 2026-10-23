"use server";

import { createHash } from "node:crypto";
import { AccountStatus, BookingStatus, NotificationType, PaymentMethod, PaymentRequestMode, PaymentStage, PricingMode, RoleKey, StaffStatus, StaffType } from "@prisma/client";
import { ZodError } from "zod";
import { headers } from "next/headers";
import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { toFriendlyError } from "@/lib/errors";
import { notifyAdmins, notifyAdminsSafely, notifyUser } from "@/lib/notifications";
import { getCurrentUser, isAdminRole, requireAdmin, requireCustomer, requireStaff, requestIp, requireSuperAdmin } from "@/lib/rbac";
import { approveAccessRequest, inviteTeamMember, rejectAccessRequest, resendTeamInvite, submitAccessRequest } from "@/lib/auth/team";
import {
  approveAccountAccess,
  changeUserRole,
  rejectAccountAccess,
  removeAdminAccess,
  removeCustomerAccess,
  setAccountActive,
} from "@/lib/access-management";
import { recordSecurityEvent } from "@/lib/security-audit";
import { revokeAllSessions } from "@/lib/auth/session";
import {
  sendAccessApprovedEmail,
  sendAccessDeclinedEmail,
  sendPaymentRequestEmail,
} from "@/lib/mailer";
import {
  createBookingForPublicCustomer,
  createEvent,
  createPayment,
  ensureInvoice,
  updateBookingStatus,
} from "@/lib/bookings";
import { emitAdminEvent } from "@/lib/realtime";
import { customerFacingBookingMessage, isAccountRequiredBookingError } from "@/lib/public-booking-error";
import { paymentRequestTarget, roundCurrency, PAYMENT_REQUEST_LABEL } from "@/lib/payment-requests";
import { approveCashPayment, declareCashPayment, rejectCashPayment } from "@/lib/cash-payments";
import { assertCloudinaryAssetPair, deleteCloudinaryImage } from "@/lib/cloudinary";
import { formatInventoryCategory } from "@/lib/inventory";
import { withSerializableRetry } from "@/lib/transactions";
import { absoluteUrl } from "@/lib/site";
import { eventRangesOverlap, isAssignmentLive } from "@/lib/staff-assignment";
import { BUSINESS_SETTINGS_TAG } from "@/lib/settings";
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
  // Messages written for the customer are forwarded verbatim; everything else
  // is replaced so an internal failure never leaks a stack-shaped string. The
  // list of which is which lives in one place — see `lib/public-booking-error.ts`
  // for what happens when the two copies of it drift apart.
  const customerMessage = customerFacingBookingMessage(error);
  if (customerMessage) return customerMessage;
  /*
   * The customer gets the friendly sentence, but the cause is written here —
   * otherwise an internal failure is indistinguishable from "the booking form is
   * broken", which is exactly what it looks like from the outside.
   */
  console.error("[booking] request failed", error);
  return "We could not create the booking right now. Please try again.";
}



export type ActionState = {
  success: string | null;
  error: string | null;
  bookingId?: string;
  publicToken?: string;
  /**
   * A machine-readable reason, for a form that has to *act* on the failure rather
   * than print it. `ACCOUNT_REQUIRED` is the one that matters: the request needs
   * an account before a booking can exist, so the form offers both ways forward —
   * see `isAccountRequiredBookingError`.
   */
  code?: "ACCOUNT_REQUIRED";
};

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key).trim();
  return value || undefined;
}

/**
 * Every value submitted under one key, in order and without duplicates.
 *
 * A multi-select posts one entry per chosen value under the same name, so this is
 * the read side of it. Blanks are dropped rather than rejected: a form that
 * renders one hidden field per selected option leaves an empty one behind the
 * moment the last option is un-ticked.
 */
function getStringList(formData: FormData, key: string) {
  return Array.from(new Set(formData.getAll(key).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)));
}

function getNumber(formData: FormData, key: string) {
  const raw = getString(formData, key).trim();
  if (!raw) throw new Error(`${key} is required.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a valid number.`);
  return value;
}

/**
 * A number the form may legitimately have left out.
 *
 * Used for a field that is only rendered when it can change something — the day
 * count appears only when something in the quote is priced per day. Absent means
 * one day, and the schema still bounds whatever arrives, so a hand-edited value is
 * refused rather than believed.
 */
function getOptionalNumber(formData: FormData, key: string, fallback: number) {
  const raw = getString(formData, key).trim();
  if (!raw) return fallback;
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

type StockSnapshot = { name: string; category: string; availableQuantity: number; reorderLevel: number };

/**
 * Raises a live alert when an inventory write leaves stock at or below its
 * reorder level.
 *
 * The reservation path already warned when a booking consumed the last units,
 * but a manual edit could silently do the same thing — lowering `totalQuantity`
 * or archiving a stocked item. Every admin now sees the shortfall immediately
 * instead of finding it when the next booking fails to reserve.
 */
async function alertLowStock(items: readonly StockSnapshot[]) {
  const exhausted = items.filter((item) => item.availableQuantity <= 0);
  const low = items.filter((item) => item.availableQuantity > 0 && item.availableQuantity <= item.reorderLevel);
  if (exhausted.length === 0 && low.length === 0) return;

  const describe = (item: StockSnapshot) => `${item.name} (${formatInventoryCategory(item.category).toLowerCase()})`;
  if (exhausted.length > 0) {
    await notifyAdmins({
      type: NotificationType.LOW_INVENTORY,
      title: exhausted.length === 1 ? "Out of stock" : `${exhausted.length} items out of stock`,
      message: `${exhausted.map(describe).join(", ")} ${exhausted.length === 1 ? "has" : "have"} no units available. Services that need this stock cannot be booked until it is restocked.`,
      href: "/admin/inventory",
    });
  }
  if (low.length > 0) {
    await notifyAdmins({
      type: NotificationType.LOW_INVENTORY,
      title: exhausted.length === 0 && low.length === 1 ? "Low inventory alert" : `${low.length} items low on stock`,
      message: `${low.map((item) => `${describe(item)}: ${item.availableQuantity} left, reorder at ${item.reorderLevel}`).join(" · ")}.`,
      href: "/admin/inventory",
    });
  }
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
      customerAddress: getString(formData, "customerAddress"),
      eventType: getString(formData, "eventType"),
      eventDate: getString(formData, "eventDate"),
      // The end of the range, when the customer gave one. The day count is
      // derived from the range on the server, so the two cannot disagree.
      eventEndDate: getString(formData, "eventEndDate"),
      location: getString(formData, "location"),
      guestCount: getNumber(formData, "guestCount"),
      // Only sent when the quote contains a per-day service, so an absent field
      // means a single-day event. Reading it here is what makes a three-day
      // function bill three days and hold three days of stock, rather than one.
      durationDays: getOptionalNumber(formData, "durationDays", 1),
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
    return {
      success: null,
      error: publicBookingError(error),
      code: isAccountRequiredBookingError(error) ? "ACCOUNT_REQUIRED" : undefined,
    };
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

export async function declareCashPaymentAction(formData: FormData): Promise<ActionState> {
  try {
    const current = await requireCustomer();
    if (!current.customerProfile) throw new Error("Complete your customer profile before declaring a cash payment.");
    await enforceActionRateLimit("cash-payment", current.id, 10, 60_000);
    const bookingId = getString(formData, "bookingId");
    const amount = getNumber(formData, "amount");
    await declareCashPayment({ bookingId, customerId: current.customerProfile.id, amount });
    revalidatePath("/customer/dashboard");
    revalidatePath(`/customer/bookings/${bookingId}`);
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/payments");
    return { success: "Cash payment submitted. Our team will confirm it before your balance changes.", error: null, bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function approveCashPaymentAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const paymentId = getString(formData, "paymentId");
    await enforceActionRateLimit("cash-approval", paymentId, 20, 60_000);
    const result = await approveCashPayment(paymentId);
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${result.bookingId}`);
    revalidatePath("/admin/payments");
    revalidatePath("/admin/invoices");
    revalidatePath("/customer/dashboard");
    revalidatePath(`/customer/bookings/${result.bookingId}`);
    return { success: "Cash payment approved and added to the booking balance.", error: null, bookingId: result.bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function rejectCashPaymentAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const paymentId = getString(formData, "paymentId");
    await enforceActionRateLimit("cash-rejection", paymentId, 20, 60_000);
    const result = await rejectCashPayment(paymentId);
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${result.bookingId}`);
    revalidatePath("/admin/payments");
    revalidatePath("/customer/dashboard");
    revalidatePath(`/customer/bookings/${result.bookingId}`);
    return { success: "Cash payment rejected. No balance was changed.", error: null, bookingId: result.bookingId };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function requestPaymentAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    await enforceActionRateLimit("payment-request", bookingId, 20, 60_000);
    const mode = getString(formData, "mode") as PaymentRequestMode;
    if (!Object.values(PaymentRequestMode).includes(mode)) throw new Error("Choose an advance, half, or the full balance.");
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, totalAmount: true, paidAmount: true, balanceAmount: true, customer: { select: { userId: true, user: { select: { email: true, firstName: true, lastName: true } } } } },
    });
    if (!booking) throw new Error("Booking not found.");
    const payableStatuses: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED];
    if (!payableStatuses.includes(booking.status)) throw new Error("Payment can only be requested after the booking is approved.");
    if (Number(booking.balanceAmount) <= 0) throw new Error("This booking is already fully paid.");
    const paid = Number(booking.paidAmount);
    const balance = Number(booking.balanceAmount);
    // HALF means half of what is still owed, so the cumulative target includes
    // the amount already paid. Using only the total here is what made a 50%
    // request on a 75%-outstanding booking ask for 25% of the total.
    const target = paymentRequestTarget(mode, Number(booking.totalAmount), { paidAmount: paid, balanceAmount: balance });
    if (target - paid < 0.01) throw new Error("The customer has already paid that amount. Choose a larger request.");
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentRequestMode: mode, paymentRequestTargetAmount: target, paymentRequestedAt: new Date() },
    });
    const due = roundCurrency(Math.min(balance, target - paid));
    await notifyUser(booking.customer.userId, {
      type: NotificationType.PAYMENT_REQUESTED,
      title: "Payment requested",
      message: `Our team has requested a payment of ₹${due.toLocaleString("en-IN")} for your booking. You can pay it from your dashboard.`,
      href: `/customer/bookings/${bookingId}`,
    });
    await notifyAdminsSafely({
      type: NotificationType.PAYMENT_REQUESTED,
      title: "Payment request sent",
      message: `${[booking.customer.user.firstName, booking.customer.user.lastName].filter(Boolean).join(" ") || "A customer"} was asked to pay ₹${due.toLocaleString("en-IN")} for booking ${bookingId.slice(0, 8).toUpperCase()} (${PAYMENT_REQUEST_LABEL[mode]}).`,
      href: `/admin/bookings/${bookingId}`,
    });
    const mail = await sendPaymentRequestEmail({
      to: booking.customer.user.email,
      firstName: booking.customer.user.firstName,
      reference: booking.id.slice(0, 8).toUpperCase(),
      amount: due,
      modeLabel: PAYMENT_REQUEST_LABEL[mode],
      balanceAmount: Number(booking.balanceAmount),
      bookingUrl: absoluteUrl(`/customer/bookings/${bookingId}`),
    });
    emitAdminEvent("booking.updated", { entityId: bookingId, action: "payment-requested" });
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/customer/dashboard");
    revalidatePath(`/customer/bookings/${bookingId}`);
    return {
      success: mail.sent
        ? `Payment request sent for ₹${due.toLocaleString("en-IN")}.`
        : `Payment request saved for ₹${due.toLocaleString("en-IN")}, but the email could not be sent. The customer can still see it on their dashboard.`,
      error: null,
      bookingId,
    };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

export async function clearPaymentRequestAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const bookingId = getString(formData, "bookingId");
    await enforceActionRateLimit("payment-request-clear", bookingId, 20, 60_000);
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { customer: { select: { userId: true } } } });
    if (!booking) throw new Error("Booking not found.");
    await prisma.booking.updateMany({
      where: { id: bookingId },
      data: { paymentRequestMode: null, paymentRequestTargetAmount: null, paymentRequestedAt: null },
    });
    await notifyUser(booking.customer.userId, {
      type: NotificationType.PAYMENT_REQUESTED,
      title: "Payment request withdrawn",
      message: "Our team has withdrawn the latest payment request for your booking.",
      href: `/customer/bookings/${bookingId}`,
    });
    await notifyAdminsSafely({
      type: NotificationType.PAYMENT_REQUESTED,
      title: "Payment request withdrawn",
      message: `The latest payment request for booking ${bookingId.slice(0, 8).toUpperCase()} was withdrawn.`,
      href: `/admin/bookings/${bookingId}`,
    });
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath(`/customer/bookings/${bookingId}`);
    return { success: "Payment request withdrawn.", error: null, bookingId };
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
    await alertLowStock([item]);
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
        select: { id: true, imagePublicId: true, name: true, category: true, availableQuantity: true, reorderLevel: true },
      });
      return { ...updated, oldPublicId: existing.imagePublicId };
    });
    if (current.oldPublicId && current.oldPublicId !== data.imagePublicId) await deleteCloudinaryImage(current.oldPublicId);
    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/bookings/${current.id}`);
    emitAdminEvent("inventory.updated", { entityId: current.id, action: "updated" });
    await alertLowStock([current]);
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

/**
 * Warns admins when a service is pointed at a stock category that has nothing
 * active behind it. The booking form will refuse every request for that
 * service, so the catalog owner has to know immediately rather than by reading
 * failed quotes later.
 */
async function alertUnconfiguredInventory(categories: readonly string[], serviceName: string) {
  if (categories.length === 0) return;
  const configured = await prisma.inventory.findMany({
    where: { category: { in: [...categories] as never[] }, isActive: true },
    select: { category: true },
    distinct: ["category"],
  });
  const missing = categories.filter((category) => !configured.some((row) => row.category === category));
  if (missing.length === 0) return;
  await notifyAdmins({
    type: NotificationType.LOW_INVENTORY,
    title: "No inventory configured",
    message: `"${serviceName}" is linked to ${missing.map((category) => formatInventoryCategory(category).toLowerCase()).join(", ")} but no active inventory item uses ${missing.length === 1 ? "that category" : "those categories"}, so bookings that need ${missing.length === 1 ? "it" : "them"} will be refused. Add stock or unlink ${missing.length === 1 ? "it" : "them"}.`,
    href: "/admin/inventory",
  });
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
      inventoryCategories: getStringList(formData, "inventoryCategories"),
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
        inventoryCategories: data.inventoryCategories,
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
    await alertUnconfiguredInventory(data.inventoryCategories, service.name);
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
      inventoryCategories: getStringList(formData, "inventoryCategories"),
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
        inventoryCategories: data.inventoryCategories,
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
    await alertUnconfiguredInventory(data.inventoryCategories, service.name);
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
    // Archiving hides stock from new reservations, so an archived-but-full item
    // is as good as an outage and must be announced the same way.
    await alertLowStock(await prisma.inventory.findMany({ where: { isActive: true }, select: { name: true, category: true, availableQuantity: true, reorderLevel: true } }));
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
      const item = await tx.inventory.findUnique({ where: { id }, select: { id: true, name: true, category: true, bookedQuantity: true, imagePublicId: true, _count: { select: { bookingInventory: true } } } });
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
    await alertLowStock(await prisma.inventory.findMany({ where: { isActive: true, category: result.category }, select: { name: true, category: true, availableQuantity: true, reorderLevel: true } }));
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

export async function updateStaffAction(formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    await enforceActionRateLimit("staff-update", getString(formData, "id"), 30, 60_000);
    const rawStaffType = formData.get("staffType");
    const data = staffUpdateSchema.parse({
      id: getString(formData, "id"),
      // Only read when present: the role form posts no `isAvailable`, and
      // `getBoolean` throws on a missing key rather than returning undefined.
      isAvailable: formData.has("isAvailable") ? getBoolean(formData, "isAvailable") : undefined,
      staffType: typeof rawStaffType === "string" && rawStaffType ? rawStaffType : undefined,
    });
    const existing = await prisma.staff.findUnique({ where: { id: data.id }, select: { status: true, staffType: true } });
    if (!existing) throw new Error("Staff member not found.");
    if (existing.status !== StaffStatus.ACTIVE) throw new Error("Only active staff can be updated.");
    if (data.staffType && data.staffType === existing.staffType) {
      return { success: "No changes to save.", error: null };
    }
    if (data.staffType) {
      await prisma.staff.update({ where: { id: data.id }, data: { staffType: data.staffType } });
      revalidatePath("/admin/staff");
      revalidatePath("/staff");
      revalidatePath("/admin/bookings");
      emitAdminEvent("staff.updated", { entityId: data.id, action: "role-updated" });
      return { success: `Role updated to ${data.staffType.toLowerCase().replaceAll("_", " ")}.`, error: null };
    }
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
          status: true,
          user: {
            select: {
              firstName: true,
              adminProfile: { select: { id: true } },
            },
          },
        },
      });
      if (!member) throw new Error("Staff member not found.");
      if (member.status === StaffStatus.SUSPENDED) throw new Error("This staff member's access has already been removed.");
      if (member.user.adminProfile) {
        throw new Error("This person is also an administrator. Remove their admin role instead.");
      }

      // Removal must not delete the Staff row: every BookingStaff assignment
      // points at it, and those are the only record of the work this person
      // did. Suspending the row keeps the history the admin still needs while
      // making the account unusable.
      await tx.staff.update({
        where: { id },
        data: {
          status: StaffStatus.SUSPENDED,
          isAvailable: false,
          adminId: null,
          inviteToken: null,
          inviteExpiresAt: null,
        },
      });
      await tx.user.update({
        where: { id: member.userId },
        data: {
          isActive: false,
          accountStatus: AccountStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspensionReason: "Staff access removed by an administrator.",
        },
      });

      // Burn every outstanding activation link and verification code. An old
      // invite must not be able to revive the account after this decision.
      await tx.activationToken.updateMany({ where: { userId: member.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.otpChallenge.updateMany({ where: { userId: member.userId, consumedAt: null }, data: { consumedAt: new Date() } });

      return { firstName: member.user.firstName, userId: member.userId };
    });

    // Suspension already blocks every request, so a failure to revoke cannot
    // restore access. Revoking is still what makes the current browser sign out
    // immediately instead of showing a stale cached page.
    await revokeAllSessions(result.userId, "Staff access removed by an administrator.").catch((error) => {
      console.error("[staff] session revocation failed after removal", error);
    });
    await recordSecurityEvent({
      type: "ACCOUNT_SUSPENDED",
      userId: result.userId,
      detail: "Staff access removed. The staff row and previous assignments were kept for history.",
    });
    revalidatePath("/admin/staff");
    revalidatePath("/admin/security");
    revalidatePath("/admin/admins");
    revalidatePath("/staff");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/events");
    emitAdminEvent("staff.updated", { entityId: id, action: "removed" });
    return {
      success: `${result.firstName}'s staff access was removed. Their previous assignments remain available in the admin history.`,
      error: null,
    };
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
      /*
       * The same person cannot be put on the same event twice.
       *
       * The insert used to be an upsert with an empty update, so a second
       * attempt was swallowed and the admin was told "Staff member assigned to
       * the booking" — as though something had happened. It had not: the
       * roster still had one row, and the duplicate had quietly been the
       * reason the drop-down still offered somebody who was already on the
       * event.
       */
      const alreadyOnThisBooking = await tx.bookingStaff.findUnique({
        where: { bookingId_staffId: { bookingId, staffId } },
        select: { id: true },
      });
      if (alreadyOnThisBooking) throw new Error("That staff member is already assigned to this event.");
      /*
       * The same person cannot work two events that overlap.
       *
       * The check used to be a twelve-hour window around the first day, which
       * was wrong twice over once an event could run for more than one day: an
       * event running from the 2nd to the 4th clashed with nothing booked on
       * the 3rd, so the same person could be sent to two places on one day.
       *
       * The whole range is compared now, and only events that are still live
       * count. A released assignment — one whose event has already happened —
       * is history, not a commitment, so it does not stand in the way of the
       * next booking. See `lib/staff-assignment.ts`.
       */
      const otherAssignments = await tx.bookingStaff.findMany({
        where: { staffId, bookingId: { not: bookingId } },
        select: { booking: { select: { status: true, eventDate: true, durationDays: true } } },
      });
      const clash = otherAssignments.find((assignment) => {
        const other = assignment.booking;
        if (!isAssignmentLive(other)) return false;
        return eventRangesOverlap(other, { status: booking.status, eventDate: booking.eventDate, durationDays: booking.durationDays });
      });
      if (clash) throw new Error("That staff member is already assigned to an event that overlaps these dates.");
      await tx.bookingStaff.create({ data: { bookingId, staffId } });
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
    const assignableStatuses: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.PREPARING];
    /*
     * The roster of a finished event is a record of who worked it, not a list
     * of people still to be booked. Removing somebody from it would erase
     * that, and the button is not offered in the first place — but a stale
     * form post could still try, so the rule is enforced here too.
     */
    const assignment = await prisma.bookingStaff.findFirst({
      where: { id: assignmentId, bookingId },
      select: { booking: { select: { status: true, eventDate: true, durationDays: true } } },
    });
    if (!assignment) throw new Error("That staff member is not assigned to this event.");
    if (!isAssignmentLive(assignment.booking)) {
      throw new Error("This event is over, so its team list is a record of who worked it and cannot be changed.");
    }
    const removed = await prisma.bookingStaff.deleteMany({
      where: {
        id: assignmentId,
        bookingId,
        booking: { status: { in: assignableStatuses } },
      },
    });
    if (removed.count !== 1) throw new Error("Staff assignments can only be changed on active bookings.");
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
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { customerId: true, status: true, paidAmount: true } });
    if (!booking || !current.customerProfile || booking.customerId !== current.customerProfile.id) throw new Error("You cannot cancel this booking.");
    /*
     * A request belongs to the customer only while it is still a request. Once
     * the team has approved it they have committed stock, staff, and a calendar
     * slot to that date, so undoing it is their decision, not a button on the
     * customer dashboard. `updateBookingStatus` still lets an administrator
     * cancel an approved booking (subject to refunding any captured payment).
     */
    if (booking.status !== BookingStatus.PENDING) {
      throw new Error("This booking has already been reviewed. Contact the team to change or cancel it.");
    }
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

/**
 * Marks a set of the caller's own notifications as read.
 *
 * Used when the reader reaches the page a notification is about by any route,
 * not only by clicking the notification itself. The ids are scoped to the
 * caller and to the admin audience, so a request cannot mark somebody else's
 * notifications read.
 */
export async function markNotificationsSeenAction(notificationIds: string[]): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const ids = notificationIds.filter((id) => typeof id === "string" && id.length > 0).slice(0, 50);
    if (ids.length === 0) return { success: null, error: null };
    await enforceActionRateLimit("notification-seen", admin.id, 120, 60_000);
    await prisma.notification.updateMany({
      where: { id: { in: ids }, userId: admin.id, audience: "ADMIN" },
      data: { read: true },
    });
    revalidatePath("/admin/notifications");
    return { success: "Notifications marked as read.", error: null };
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

/**
 * Explicit privilege grant. Separated from approval on purpose: approving grants
 * workspace access, while a role change grants or removes privilege.
 */
export async function changeUserRoleAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireAdmin();
    const userId = getString(formData, "userId");
    const rawRole = getString(formData, "role");
    const nextRole = Object.values(RoleKey).find((role) => role === rawRole);
    if (!userId || !nextRole) throw new Error("Choose a valid role.");
    await enforceActionRateLimit("user-role", userId, 20, 60_000);
    const requestedStaffType = getOptionalString(formData, "staffType");
    const outcome = await changeUserRole({
      reviewer: { id: reviewer.id, role: reviewer.role },
      userId,
      nextRole,
      staffType: Object.values(StaffType).find((type) => type === requestedStaffType) ?? null,
      ipAddress: await requestIp(),
    });
    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/staff");
    revalidatePath("/admin/notifications");
    // The old role's workspace can change too (an admin who becomes a customer
    // no longer has an `/admin` page to be stale on).
    if (outcome.previousRole === RoleKey.ADMIN || outcome.previousRole === RoleKey.SUPER_ADMIN) revalidatePath("/admin");
    if (outcome.previousRole === RoleKey.STAFF) revalidatePath("/staff");
    if (outcome.role === RoleKey.STAFF) revalidatePath("/staff");
    return {
      success: `Role updated to ${nextRole.toLowerCase().replaceAll("_", " ")}.`,
      error: null,
    };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/**
 * Promotes an existing account to administrator.
 *
 * `/admin/admins` lists only administrator accounts, which is what makes that
 * screen readable — but it also means there is no row on it to click "promote"
 * against for a staff member or customer. This is that capability, addressed by
 * email address rather than by showing the whole user base again.
 *
 * Delegated to `changeUserRole` so a promotion is audited and revokes the
 * target's live sessions exactly like any other role change.
 */
export async function grantAdminAccessAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireSuperAdmin();
    const email = getString(formData, "email").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Enter the email address of the account to promote.");

    const target = await prisma.user.findUnique({
      where: { email },
      select: { id: true, firstName: true, role: { select: { key: true } }, accountStatus: true, isActive: true },
    });
    // Same wording whether the address is unknown or belongs to nobody we can
    // promote, so this does not become a way to test whether an address has an
    // account here.
    if (!target) throw new Error("No account with that email address was found.");
    if (isAdminRole(target.role.key)) throw new Error("That account already holds an administrator role.");

    await changeUserRole({
      reviewer: { id: reviewer.id, role: reviewer.role },
      userId: target.id,
      nextRole: RoleKey.ADMIN,
      ipAddress: await requestIp(),
    });

    // A promotion into a role that requires a second factor would otherwise
    // strand the person at the "set up 2FA" gate with no obvious way forward.
    if (!target.isActive || target.accountStatus !== AccountStatus.ACTIVE) {
      await approveAccountAccess({
        reviewer: { id: reviewer.id, role: reviewer.role },
        userId: target.id,
        reason: "Approved on administrator promotion.",
        ipAddress: await requestIp(),
      }).catch(() => undefined);
    }

    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/staff");
    revalidatePath("/admin/customers");
    revalidatePath("/admin/notifications");

    const name = [target.firstName].filter(Boolean).join(" ").trim();
    return {
      success: `${name || email} is now an administrator. They must set up two-factor authentication before reaching any admin page.`,
      error: null,
    };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/**
 * Removes another administrator's operator access. Super admin only, enforced
 * in `removeAdminAccess` as well as here so the rule cannot be bypassed by
 * calling the service directly.
 */
export async function removeAdminAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireSuperAdmin();
    const userId = getString(formData, "userId");
    if (!userId) throw new Error("Missing administrator.");
    await enforceActionRateLimit("admin-remove", userId, 20, 60_000);
    const result = await removeAdminAccess({
      reviewer: { id: reviewer.id, role: reviewer.role },
      userId,
      reason: getOptionalString(formData, "reason") ?? null,
      ipAddress: await requestIp(),
    });
    revalidatePath("/admin/admins");
    revalidatePath("/admin/security");
    revalidatePath("/admin/staff");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/notifications");
    return { success: `${result.firstName} was removed from the admin team and is now a customer.`, error: null };
  } catch (error) {
    return { success: null, error: messageFromError(error) };
  }
}

/**
 * Erases a customer's personal details from the customer directory.
 *
 * Super admin only, enforced in `removeCustomerAccess` as well as here so the
 * rule cannot be bypassed by calling the service directly. The bookings are
 * deliberately left alone — the confirmation screen says as much — because they
 * are the business's own records, not the customer's data.
 */
export async function removeCustomerAction(formData: FormData): Promise<ActionState> {
  try {
    const reviewer = await requireSuperAdmin();
    const customerId = getString(formData, "customerId");
    if (!customerId) throw new Error("Missing customer.");
    await enforceActionRateLimit("customer-remove", customerId, 20, 60_000);
    const result = await removeCustomerAccess({
      reviewer: { id: reviewer.id, role: reviewer.role },
      customerId,
      reason: getOptionalString(formData, "reason") ?? null,
      ipAddress: await requestIp(),
    });
    revalidatePath("/admin/customers");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/payments");
    revalidatePath("/admin/invoices");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/security");
    const kept = result.bookings === 1 ? "1 booking was kept" : `${result.bookings} bookings were kept`;
    return { success: `${result.firstName} was removed from the customer directory. ${kept}.`, error: null };
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
    // The invitation email is delivered after this response; the member's
    // activation link is not returned to the browser.
    return { success: `Access request approved (${roleLabel}). The invitation email is on its way.`, error: null };
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
      logoUrl: getString(formData, "logoUrl") || null,
      logoPublicId: getString(formData, "logoPublicId") || null,
    });
    // One of the two on its own would be an image whose asset cannot be replaced or
    // removed later, so the pair is checked before anything is written.
    assertCloudinaryAssetPair(data.logoUrl || null, data.logoPublicId || null);

    // Read before the write: replacing the logo has to destroy the asset it
    // replaces, or every logo the business has ever used stays in the bucket
    // forever. Same rule as the service and package editors.
    const previous = await prisma.businessSetting.findUnique({ where: { id: "default" }, select: { logoPublicId: true } });
    await prisma.businessSetting.upsert({
      where: { id: "default" },
      update: data,
      create: { id: "default", ...data },
    });
    if (previous?.logoPublicId && previous.logoPublicId !== data.logoPublicId) {
      await deleteCloudinaryImage(previous.logoPublicId);
    }
    revalidatePath("/admin/settings");
    revalidatePath("/customer/bookings/new");
    revalidatePath("/");
    revalidatePath("/contact");
    revalidatePath("/services");
    revalidatePath("/services/[slug]", "page");
    revalidatePath("/packages");
    revalidatePath("/packages/[slug]", "page");
    // The business profile is cached across requests; drop it so the new name,
    // logo, and tax rate appear on the very next page rather than in five
    // minutes.
    updateTag(BUSINESS_SETTINGS_TAG);
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
      staffType: getOptionalString(formData, "staffType") || null,
      note: getString(formData, "note"),
    });
    const signedIn = await getCurrentUser();
    const result = await submitAccessRequest({
      fullName: `${data.firstName}${data.lastName ? ` ${data.lastName}` : ""}`,
      email: data.email,
      requestedRole: data.requestedRole,
      // Required for a staff request: the reviewer approves the role they were
      // asked for, so it has to reach them rather than defaulting.
      staffType: data.staffType ?? null,
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
