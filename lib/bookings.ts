import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import {
  AccountStatus,
  BookingStatus,
  NotificationAudience,
  NotificationType,
  PaymentOrderStatus,
  Prisma,
  RoleKey,
} from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/server";
import { calculateBookingPrice } from "@/lib/pricing";
import { bookingSchema, eventSchema, paymentSchema } from "@/lib/validation";
import { slugify } from "@/lib/utils";
import { emitAdminEvent, emitUserEvent } from "@/lib/realtime";
import { emitExistingNotifications, emitUserNotification } from "@/lib/notifications";
import { withSerializableRetry } from "@/lib/transactions";

const bookingInclude = {
  customer: { include: { user: true } },
  package: true,
  bookingServices: { include: { service: true } },
  bookingInventory: { include: { inventory: true } },
  bookingStaff: { include: { staff: { include: { user: true } } } },
  payments: { orderBy: { paidAt: "desc" as const } },
  invoice: true,
  event: true,
};

export const getBookingFormData = cache(async () => {
  const [services, packages] = await Promise.all([
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.package.findMany({
      where: { isActive: true, packageServices: { some: { service: { isActive: true } } } },
      include: { packageServices: { where: { service: { isActive: true } }, include: { service: true } } },
      orderBy: { price: "asc" },
    }),
  ]);

  return { services, packages };
});

export async function getBookingById(id: string) {
  return prisma.booking.findUnique({ where: { id }, include: bookingInclude });
}

export async function getBookingByIdForCustomer(id: string, customerId: string) {
  return prisma.booking.findFirst({ where: { id, customerId }, include: bookingInclude });
}

type BookingWriteClient = Prisma.TransactionClient | typeof prisma;

function bookingIdempotencyHash(data: ReturnType<typeof bookingSchema.parse>) {
  return createHash("sha256").update(JSON.stringify({
    customerEmail: data.customerEmail.toLowerCase(),
    eventType: data.eventType,
    eventDate: data.eventDate,
    location: data.location,
    guestCount: data.guestCount,
    packageId: data.packageId ?? null,
    notes: data.notes ?? "",
    services: [...data.services].sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
  })).digest("hex");
}

async function getOrCreatePublicCustomer(payload: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Set when the request came from a signed-in, approved customer session. */
  userId?: string;
  verifiedEmail?: string;
}, client: BookingWriteClient = prisma) {
  const [firstName, ...rest] = payload.customerName.trim().split(/\s+/);
  const lastName = rest.join(" ") || null;
  const email = payload.customerEmail.toLowerCase();

  // A signed-in identity may only be linked to a local account that is already
  // approved. A pending, suspended, or rejected account must never acquire a
  // customer profile (and therefore booking history) through the public form.
  const existingBySession = payload.userId
    ? await client.user.findFirst({
        where: { id: payload.userId, isActive: true, accountStatus: AccountStatus.ACTIVE },
        include: { customerProfile: true, role: true },
      })
    : null;

  // A signed-in account always keeps its own identity. The submitted email is
  // never allowed to move a session to a different user.
  if (existingBySession) {
    if (existingBySession.customerProfile) return existingBySession.customerProfile.id;
    if (existingBySession.role.key === RoleKey.CUSTOMER) {
      const profile = await client.customer.create({ data: { userId: existingBySession.id } });
      return profile.id;
    }
    throw new Error("This account is reserved for administrators.");
  }

  const existingByEmail = await client.user.findUnique({
    where: { email },
    include: { customerProfile: true, role: true },
  });

  if (existingByEmail) {
    // An address that already belongs to an account is never re-pointed at an
    // anonymous enquiry, and a team account is never silently downgraded to a
    // customer. The requester must sign in with that address instead.
    if (!payload.userId) {
      throw new Error("This booking request could not be created. Sign in with the account email and try again.");
    }
    if (existingByEmail.role.key !== RoleKey.CUSTOMER) {
      throw new Error("This email is reserved for an administrator account.");
    }

    // A signed-in customer may keep their own contact details current.
    const updated = await client.user.update({
      where: { id: existingByEmail.id },
      data: { firstName, lastName, phone: payload.customerPhone },
      include: { customerProfile: true, role: true },
    });
    if (updated.customerProfile) return updated.customerProfile.id;
    const profile = await client.customer.create({ data: { userId: updated.id } });
    return profile.id;
  }

  const customerRole = await client.role.findUniqueOrThrow({
    where: { key: RoleKey.CUSTOMER },
  });

  const user = await client.user.create({
    data: {
      email,
      phone: payload.customerPhone,
      firstName,
      lastName,
      roleId: customerRole.id,
      // A public enquiry creates a customer record with no login behind it. The
      // address is already known and verified by the admin, so the account is
      // usable for booking/invoice history straight away.
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      customerProfile: { create: {} },
    },
    include: { customerProfile: true },
  });

  return user.customerProfile!.id;
}

export async function createBookingForPublicCustomer(rawData: unknown) {
  const data = bookingSchema.parse(rawData);
  const eventDate = new Date(data.eventDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (eventDate < today) throw new Error("Event date must be today or later.");

  // A signed-in customer's session links the booking to their own account. The
  // address is re-read from the database rather than the form so a booking can
  // never be attached to an account that merely claims the same email.
  const session = await getCurrentUser();
  const signedInCustomer = session?.role === RoleKey.CUSTOMER ? session : null;
  const canLinkAccount = Boolean(signedInCustomer) && signedInCustomer?.email.toLowerCase() === data.customerEmail.toLowerCase();
  const selectedServiceIds = Array.from(new Set(data.services.map((service) => service.serviceId)));
  const requestHash = data.idempotencyKey ? bookingIdempotencyHash(data) : null;

  try {
    const booking = await withSerializableRetry(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.booking.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { customer: { include: { user: true } } } });
        if (existing) {
          if (existing.customer.user.email.toLowerCase() !== data.customerEmail.toLowerCase() || (existing.idempotencyHash && existing.idempotencyHash !== requestHash)) throw new Error("That idempotency key was already used for a different booking request.");
          return { booking: existing, notifications: [] };
        }
      }

      const [services, pkg, settings] = await Promise.all([
        tx.service.findMany({ where: { id: { in: selectedServiceIds }, isActive: true } }),
        data.packageId ? tx.package.findFirst({ where: { id: data.packageId, isActive: true, packageServices: { some: { service: { isActive: true } } } }, include: { packageServices: { where: { service: { isActive: true } }, include: { service: true } } } }) : null,
        tx.businessSetting.findUnique({ where: { id: "default" }, select: { taxRate: true } }),
      ]);
      if (selectedServiceIds.length > 0 && services.length !== selectedServiceIds.length) throw new Error("One or more selected services are no longer available.");
      if (data.packageId && !pkg) throw new Error("The selected package is no longer available.");

      const pricing = calculateBookingPrice({ pkg, services, selectedServices: data.services, guestCount: data.guestCount, taxRate: settings ? Number(settings.taxRate) : undefined });
      if (!Number.isFinite(pricing.totalAmount) || pricing.totalAmount > 100000000) throw new Error("The booking quote is too large. Please contact our team for a custom proposal.");
       if (pricing.subtotal <= 0) throw new Error("Choose a package or service before sending the request.");
      const customerId = await getOrCreatePublicCustomer({ customerName: data.customerName, customerEmail: data.customerEmail, customerPhone: data.customerPhone, userId: canLinkAccount ? signedInCustomer?.id : undefined }, tx);
      const packageSnapshot = pkg?.packageServices.map((entry) => ({ serviceId: entry.serviceId, name: entry.service.name, quantity: entry.quantity, pricingMode: entry.service.pricingMode, inventoryCategory: entry.service.inventoryCategory })) ?? null;
      const created = await tx.booking.create({
        data: {
          customerId,
          packageId: pkg?.id ?? null,
          packageNameSnapshot: pkg?.name ?? null,
          packageServicesSnapshot: packageSnapshot ?? Prisma.JsonNull,
          eventType: data.eventType,
          eventDate,
          location: data.location,
          guestCount: data.guestCount,
          notes: data.notes || null,
          subtotal: pricing.subtotal,
          taxAmount: pricing.taxAmount,
          totalAmount: pricing.totalAmount,
          balanceAmount: pricing.balanceAmount,
          idempotencyKey: data.idempotencyKey || null,
          idempotencyHash: requestHash,
          publicToken: randomUUID(),
          publicTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          bookingServices: { create: pricing.serviceLines.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity, unitPrice: line.unitPrice, totalPrice: line.totalPrice })) },
        },
        include: { customer: { include: { user: true } } },
      });
      const admins = await tx.user.findMany({ where: { isActive: true, accountStatus: AccountStatus.ACTIVE, role: { key: { in: [RoleKey.SUPER_ADMIN, RoleKey.ADMIN] } } }, select: { id: true } });
      let bookingNotifications: Array<{ id: string; title: string; message: string; type: NotificationType; read: boolean; createdAt: Date }> = [];
      if (admins.length > 0) {
        const title = "New booking request";
        const message = `${created.customer.user.firstName} requested a ${created.eventType.toLowerCase()} booking for ${created.location}.`;
        await tx.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, audience: NotificationAudience.ADMIN, type: NotificationType.NEW_BOOKING_REQUEST, title, message })) });
        bookingNotifications = await tx.notification.findMany({
          where: { userId: { in: admins.map((admin) => admin.id) }, type: NotificationType.NEW_BOOKING_REQUEST, title, message },
          orderBy: { createdAt: "desc" },
        });
      }
      return { booking: created, notifications: bookingNotifications };
    });

    emitAdminEvent("booking.created", { entityId: booking.booking.id, action: "created" });
    emitUserEvent(booking.booking.customer.user.id, "booking.created", { entityId: booking.booking.id, action: "created" });
    emitExistingNotifications(booking.notifications, "/admin/bookings");
    return booking.booking;
  } catch (error) {
    // A concurrent request may win the unique idempotency constraint between
    // the first read and commit. Return only the matching customer's winner.
    if (data.idempotencyKey) {
      const existing = await prisma.booking.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { customer: { include: { user: true } } } });
      if (existing && existing.customer.user.email.toLowerCase() === data.customerEmail.toLowerCase() && (!existing.idempotencyHash || existing.idempotencyHash === requestHash)) return existing;
    }
    throw error;
  }
}

async function reserveInventoryForBookingInTransaction(tx: Prisma.TransactionClient, bookingId: string) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      bookingServices: { include: { service: true } },
      package: { include: { packageServices: { include: { service: true } } } },
      bookingInventory: true,
    },
  });
  if (!booking) throw new Error("Booking not found.");
  if (booking.bookingInventory.length > 0) return;

  const requirements = new Map<string, number>();
  const addRequirement = (category: string | null, quantity: number) => {
    if (!category || quantity <= 0) return;
    requirements.set(category, (requirements.get(category) ?? 0) + quantity);
  };
  for (const item of booking.bookingServices) addRequirement(item.service.inventoryCategory, item.quantity);
  const packageLines = Array.isArray(booking.packageServicesSnapshot)
    ? booking.packageServicesSnapshot
    : booking.package?.packageServices.map((item) => ({ quantity: item.quantity, pricingMode: item.service.pricingMode, inventoryCategory: item.service.inventoryCategory })) ?? [];
  for (const item of packageLines) {
    const line = item as { quantity: number; pricingMode?: string | null; inventoryCategory?: string | null };
    addRequirement(line.inventoryCategory ?? null, line.pricingMode === "PER_GUEST" ? booking.guestCount * line.quantity : line.quantity);
  }
  if (requirements.size === 0) return;

  const lowInventoryNotifications: { title: string; message: string }[] = [];
  for (const [category, requiredQuantity] of requirements) {
    const inventoryItems = await tx.inventory.findMany({ where: { category: category as never, isActive: true }, orderBy: { availableQuantity: "desc" } });
    if (inventoryItems.length === 0) throw new Error(`No inventory is configured for ${category.toLowerCase().replaceAll("_", " ")}.`);
    let remaining = requiredQuantity;
    for (const inventory of inventoryItems) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, inventory.availableQuantity);
      if (quantity <= 0) continue;
      const updated = await tx.inventory.updateMany({ where: { id: inventory.id, availableQuantity: { gte: quantity } }, data: { bookedQuantity: { increment: quantity }, availableQuantity: { decrement: quantity } } });
      if (updated.count !== 1) continue;
      await tx.bookingInventory.create({ data: { bookingId, inventoryId: inventory.id, quantity } });
      remaining -= quantity;
      if (inventory.availableQuantity - quantity <= inventory.reorderLevel) lowInventoryNotifications.push({ title: "Low inventory alert", message: `${inventory.name} is low on stock after reserving ${quantity} unit(s).` });
    }
    if (remaining > 0) throw new Error(`Not enough inventory for ${category.toLowerCase().replaceAll("_", " ")}. ${remaining} unit(s) short.`);
  }

  if (lowInventoryNotifications.length > 0) {
    const admins = await tx.user.findMany({ where: { isActive: true, accountStatus: AccountStatus.ACTIVE, role: { key: { in: [RoleKey.SUPER_ADMIN, RoleKey.ADMIN] } } }, select: { id: true } });
    if (admins.length > 0) {
      await tx.notification.createMany({ data: admins.flatMap((admin) => lowInventoryNotifications.map((item) => ({ userId: admin.id, audience: NotificationAudience.ADMIN, type: NotificationType.LOW_INVENTORY, title: item.title, message: item.message }))) });
      const created = await tx.notification.findMany({
        where: { userId: { in: admins.map((a) => a.id) }, type: NotificationType.LOW_INVENTORY, message: { in: lowInventoryNotifications.map((item) => item.message) } },
        orderBy: { createdAt: "desc" },
      });
      emitExistingNotifications(created, "/admin/inventory");
    }
  }
}

export async function reserveInventoryForBooking(bookingId: string) {
  await withSerializableRetry((tx) => reserveInventoryForBookingInTransaction(tx, bookingId));
}

async function releaseInventoryForBookingInTransaction(tx: Prisma.TransactionClient, bookingId: string) {
  const allocations = await tx.bookingInventory.findMany({ where: { bookingId } });
  for (const allocation of allocations) {
    const released = await tx.inventory.updateMany({ where: { id: allocation.inventoryId, bookedQuantity: { gte: allocation.quantity } }, data: { bookedQuantity: { decrement: allocation.quantity }, availableQuantity: { increment: allocation.quantity } } });
    if (released.count === 1) {
      const latest = await tx.inventory.findUnique({ where: { id: allocation.inventoryId }, select: { totalQuantity: true, availableQuantity: true } });
      if (latest && latest.availableQuantity > latest.totalQuantity) await tx.inventory.update({ where: { id: allocation.inventoryId }, data: { availableQuantity: latest.totalQuantity } });
    }
  }
  if (allocations.length > 0) await tx.bookingInventory.deleteMany({ where: { id: { in: allocations.map((allocation) => allocation.id) } } });
}

export async function releaseInventoryForBooking(bookingId: string) {
  await withSerializableRetry((tx) => releaseInventoryForBookingInTransaction(tx, bookingId));
}

export async function ensureInvoice(bookingId: string, client: BookingWriteClient = prisma): Promise<unknown> {
  if (client === prisma) return withSerializableRetry((tx) => ensureInvoice(bookingId, tx));
  const booking = await client.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error("Booking not found.");
  const unInvoiceableStatuses: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.CANCELLED, BookingStatus.REJECTED];
  if (unInvoiceableStatuses.includes(booking.status)) {
    throw new Error("Invoices are available after a booking is approved.");
  }

  const taxRate = Number(booking.subtotal) > 0 ? Number(booking.taxAmount) / Number(booking.subtotal) : 0.18;
  return client.invoice.upsert({
    where: { bookingId },
    update: {
      taxRate,
      totalAmount: booking.totalAmount,
      paidAmount: booking.paidAmount,
      balanceAmount: booking.balanceAmount,
    },
    create: {
      bookingId,
      invoiceNumber: `INV-${booking.id.slice(0, 8).toUpperCase()}`,
      taxRate,
      totalAmount: booking.totalAmount,
      paidAmount: booking.paidAmount,
      balanceAmount: booking.balanceAmount,
    },
  });
}

export async function createEventForBooking(bookingId: string, client: BookingWriteClient = prisma) {
  const booking = await client.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error("Booking not found.");

  const startDate = booking.eventDate;
  const endDate = new Date(startDate.getTime() + 8 * 60 * 60 * 1000);
  const customer = await client.customer.findUniqueOrThrow({
    where: { id: booking.customerId },
    include: { user: true },
  });
  const title = `${customer.user.firstName} ${customer.user.lastName ?? ""} ${booking.eventType}`.trim();

  return createEvent({ bookingId, title, startDate: startDate.toISOString(), endDate: endDate.toISOString(), location: booking.location }, client);
}

const allowedStatusTransitions: Record<BookingStatus, BookingStatus[]> = {
  PENDING: [BookingStatus.APPROVED, BookingStatus.REJECTED, BookingStatus.CANCELLED],
  APPROVED: [BookingStatus.PREPARING, BookingStatus.CANCELLED],
  PREPARING: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

async function releasePaymentReservationsInTransaction(tx: Prisma.TransactionClient, bookingId: string) {
  const openOrders = await tx.paymentOrder.findMany({ where: { bookingId, status: PaymentOrderStatus.CREATED }, select: { id: true, amount: true } });
  for (const order of openOrders) {
    await tx.booking.updateMany({ where: { id: bookingId, reservedPaymentAmount: { gte: order.amount } }, data: { reservedPaymentAmount: { decrement: order.amount } } });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: PaymentOrderStatus.FAILED } });
  }
}

export async function updateBookingStatus(bookingId: string, nextStatus: BookingStatus) {
  const result = await withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { customer: { include: { user: true } } } });
    if (!booking) throw new Error("Booking not found.");
    if (booking.status === nextStatus) return { booking, changed: false };
    if (nextStatus === BookingStatus.CANCELLED && Number(booking.paidAmount) > 0) throw new Error("A booking with a captured payment must be refunded before it can be cancelled.");
    if (nextStatus === BookingStatus.APPROVED) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const eventDay = new Date(booking.eventDate);
      eventDay.setHours(0, 0, 0, 0);
      if (eventDay < today) throw new Error("Past event dates cannot be approved.");
    }
    if (!allowedStatusTransitions[booking.status].includes(nextStatus)) throw new Error(`A ${booking.status.toLowerCase()} booking cannot move to ${nextStatus.toLowerCase()}.`);

    const claimed = await tx.booking.updateMany({ where: { id: bookingId, status: booking.status }, data: { status: nextStatus } });
    if (claimed.count !== 1) throw new Error("This booking was updated by another user. Refresh and try again.");

    if (nextStatus === BookingStatus.APPROVED) {
      await reserveInventoryForBookingInTransaction(tx, bookingId);
      await createEventForBooking(bookingId, tx);
      await ensureInvoice(bookingId, tx);
    }
    if (([BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.COMPLETED] as BookingStatus[]).includes(nextStatus)) {
      await releasePaymentReservationsInTransaction(tx, bookingId);
      await releaseInventoryForBookingInTransaction(tx, bookingId);
    }

    const notificationType = nextStatus === BookingStatus.APPROVED ? NotificationType.BOOKING_APPROVED : nextStatus === BookingStatus.REJECTED ? NotificationType.BOOKING_REJECTED : NotificationType.EVENT_REMINDER;
    const title = nextStatus === BookingStatus.APPROVED ? "Booking approved" : nextStatus === BookingStatus.REJECTED ? "Booking request declined" : `Booking ${nextStatus.toLowerCase()}`;
    const statusNotification = await tx.notification.create({ data: { userId: booking.customer.user.id, audience: NotificationAudience.CUSTOMER, type: notificationType, title, message: `Your booking for ${booking.location} is now ${nextStatus.toLowerCase()}.` } });
    const updated = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: { include: { user: true } } } });
    return { booking: updated, changed: true, statusNotification };
  });

  if (result.changed) {
    emitAdminEvent("booking.updated", { entityId: bookingId, action: nextStatus.toLowerCase() });
    emitUserEvent(result.booking.customer.user.id, "booking.updated", { entityId: bookingId, action: nextStatus.toLowerCase() });
    if (result.statusNotification) emitUserNotification(result.booking.customer.user.id, result.statusNotification, `/customer/bookings/${bookingId}`);
  }
  return result.booking;
}

export async function createPayment(rawData: unknown) {
  const data = paymentSchema.parse(rawData);
  const amount = Math.round((data.amount + Number.EPSILON) * 100) / 100;
  const idempotencyKey = data.idempotencyKey;

  const result = await withSerializableRetry(async (tx) => {
    if (idempotencyKey) {
      const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.bookingId !== data.bookingId || Number(existing.amount) !== amount || existing.stage !== data.stage || existing.method !== data.method || (existing.reference ?? null) !== (data.reference || null)) throw new Error("That idempotency key was already used for another payment.");
        return { payment: existing, customerId: null, amount: Number(existing.amount) };
      }
    }
    const booking = await tx.booking.findUnique({ where: { id: data.bookingId }, include: { customer: { include: { user: true } }, invoice: true } });
    if (!booking) throw new Error("Booking not found.");
    if (amount <= 0) throw new Error("Payment amount must be at least 0.01.");
    const payableStatuses: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PREPARING, BookingStatus.COMPLETED];
    if (!payableStatuses.includes(booking.status)) throw new Error("Payments can be recorded after the booking is approved.");
    const available = Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount);
    if (amount > available) throw new Error("Payment cannot be greater than the currently available balance.");
    const updated = await tx.booking.updateMany({ where: { id: booking.id, balanceAmount: { gte: amount }, status: { in: payableStatuses } }, data: { paidAmount: { increment: amount }, balanceAmount: { decrement: amount } } });
    if (updated.count !== 1) throw new Error("The booking balance changed. Refresh and try again.");
    const after = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { paidAmount: true, balanceAmount: true } });
    const created = await tx.payment.create({ data: { bookingId: booking.id, amount, stage: data.stage, method: data.method, provider: "MANUAL", status: "CAPTURED", reference: data.reference || null, idempotencyKey: idempotencyKey || null } });
    await tx.invoice.upsert({ where: { bookingId: booking.id }, update: { paidAmount: after.paidAmount, balanceAmount: after.balanceAmount }, create: { bookingId: booking.id, invoiceNumber: `INV-${booking.id.slice(0, 8).toUpperCase()}`, taxRate: Number(booking.taxAmount) > 0 ? Number(booking.taxAmount) / Number(booking.subtotal) : 0.18, totalAmount: booking.totalAmount, paidAmount: after.paidAmount, balanceAmount: after.balanceAmount } });
    const paymentNotification = await tx.notification.create({ data: { userId: booking.customer.user.id, audience: NotificationAudience.CUSTOMER, type: NotificationType.PAYMENT_RECEIVED, title: "Payment received", message: `We recorded a payment of ?${amount.toLocaleString("en-IN")} for your booking.` } });
    return { payment: created, customerId: booking.customer.user.id, amount, paymentNotification };
  });
  if (result.customerId) {
    emitAdminEvent("payment.recorded", { entityId: result.payment.bookingId, action: "manual" });
    emitUserEvent(result.customerId, "payment.recorded", { entityId: result.payment.bookingId, action: "manual" });
    if (result.paymentNotification) emitUserNotification(result.customerId, result.paymentNotification, `/customer/bookings/${result.payment.bookingId}`);
  }
  return result.payment;
}

export async function createEvent(rawData: unknown, client: BookingWriteClient = prisma): Promise<unknown> {
  if (client === prisma) return withSerializableRetry((tx) => createEvent(rawData, tx));
  const data = eventSchema.parse(rawData);
  const startDate = new Date(data.startDate);
  const endDate = new Date(data.endDate);
  if (endDate <= startDate) throw new Error("Event end time must be after the start time.");
  const booking = await client.booking.findUnique({ where: { id: data.bookingId }, select: { status: true } });
  const connectableStatuses: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PREPARING];
  if (!booking || !connectableStatuses.includes(booking.status)) {
    throw new Error("Only approved bookings can be connected to the calendar.");
  }
  const existing = await client.event.findUnique({ where: { bookingId: data.bookingId }, select: { id: true } });
  const conflict = await client.event.findFirst({
    where: {
      id: existing ? { not: existing.id } : undefined,
      startDate: { lt: endDate },
      endDate: { gt: startDate },
    },
  });
  if (conflict) throw new Error("That time overlaps another event on the operations calendar.");

  return client.event.upsert({
    where: { bookingId: data.bookingId },
    update: {
      title: data.title,
      startDate,
      endDate,
      location: data.location,
    },
    create: {
      bookingId: data.bookingId,
      title: data.title,
      startDate,
      endDate,
      location: data.location,
    },
  });
}

export async function generateInvoicePdf(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      booking: {
        include: {
          customer: { include: { user: true } },
          package: { include: { packageServices: { include: { service: true } } } },
          bookingServices: { include: { service: true } },
        },
      },
    },
  });

  if (!invoice) throw new Error("Invoice not found.");

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const customer = invoice.booking.customer.user;
  const settings = await prisma.businessSetting.findUnique({ where: { id: "default" } });
  const businessName = settings?.businessName || "Event Management";
  const currency = settings?.currency ?? "INR";

  page.drawText(`${businessName} Invoice`, {
    x: 50,
    y: 790,
    size: 24,
    font: boldFont,
    color: rgb(0.12, 0.12, 0.12),
  });
  page.drawText(`Invoice #: ${invoice.invoiceNumber}`, { x: 50, y: 760, size: 12, font });
  page.drawText(`Customer: ${customer.firstName} ${customer.lastName ?? ""}`.trim(), {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page.drawText(`Event: ${invoice.booking.eventType}`, { x: 50, y: 722, size: 12, font });
  page.drawText(`Location: ${invoice.booking.location}`, { x: 50, y: 704, size: 12, font });

  let y = 670;
  page.drawText("Services", { x: 50, y, size: 14, font: boldFont });
  y -= 24;
  const packageLines = Array.isArray(invoice.booking.packageServicesSnapshot)
    ? invoice.booking.packageServicesSnapshot
    : invoice.booking.package?.packageServices.map((item) => ({ name: item.service.name, quantity: item.quantity })) ?? [];
  for (const item of packageLines) {
    const line = item as { name?: string; quantity?: number };
    page.drawText(`${line.name ?? "Package service"} x ${line.quantity ?? 1} (package) - included`, { x: 50, y, size: 11, font });
    y -= 18;
  }
  for (const item of invoice.booking.bookingServices) {
    page.drawText(
      `${item.service.name} x ${item.quantity} - ${currency} ${Number(item.totalPrice).toLocaleString("en-IN")}`,
      { x: 50, y, size: 11, font },
    );
    y -= 18;
  }

  y -= 12;
  page.drawText(`Subtotal: ${currency} ${Number(invoice.booking.subtotal).toLocaleString("en-IN")}`, {
    x: 50,
    y,
    size: 12,
    font,
  });
  y -= 18;
  page.drawText(`Tax: ${currency} ${Number(invoice.booking.taxAmount).toLocaleString("en-IN")}`, {
    x: 50,
    y,
    size: 12,
    font,
  });
  y -= 18;
  page.drawText(`Total: ${currency} ${Number(invoice.totalAmount).toLocaleString("en-IN")}`, {
    x: 50,
    y,
    size: 12,
    font: boldFont,
  });
  y -= 18;
  page.drawText(`Paid: ${currency} ${Number(invoice.paidAmount).toLocaleString("en-IN")}`, {
    x: 50,
    y,
    size: 12,
    font,
  });
  y -= 18;
  page.drawText(`Balance: ${currency} ${Number(invoice.balanceAmount).toLocaleString("en-IN")}`, {
    x: 50,
    y,
    size: 12,
    font,
  });

  return { fileName: `${slugify(invoice.invoiceNumber)}.pdf`, bytes: await pdfDoc.save() };
}
