import { z } from "zod";
import {
  EventType,
  InventoryCategory,
  PaymentMethod,
  PaymentStage,
  PricingMode,
  StaffType,
} from "@prisma/client";

const optionalText = (max = 500) => z.string().trim().max(max).optional().or(z.literal(""));
const requiredText = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid control characters.");
const idSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid identifier.");
const optionalId = idSchema.optional().or(z.literal(""));
const idempotencyKey = z.string().trim().max(160).regex(/^[A-Za-z0-9._:-]+$/, "Invalid idempotency key.").optional().or(z.literal(""));
const phoneSchema = z.string().trim().min(8).max(20).regex(/^[+()\-\s0-9]+$/, "Enter a valid phone number.");
const numberInput = (schema: z.ZodNumber) => z.preprocess((value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, schema);
const moneyInput = (max: number) => numberInput(z.number().positive("Amount must be greater than zero.").max(max).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Use no more than two decimal places."));
const cloudinaryImageUrl = z.string().trim().max(2048).url("Enter a valid image URL.").refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && url.pathname.includes("/event-management/");
  } catch {
    return false;
  }
}, "Images must be uploaded through Cloudinary.").optional().or(z.literal(""));
const cloudinaryPublicId = z.string().trim().max(300).refine((value) => !value || (value.startsWith("event-management/") && !value.includes("..")), "Invalid Cloudinary asset reference.").optional().or(z.literal(""));

export const bookingServiceSchema = z.object({
  serviceId: idSchema,
  quantity: numberInput(z.number().int().min(1).max(100000)),
}).strict();

export const bookingSchema = z.object({
  customerName: requiredText(2, 120, "Please enter your name."),
  customerEmail: z.string().trim().toLowerCase().email("Please enter a valid email address.").max(254),
  customerPhone: phoneSchema,
  eventType: z.nativeEnum(EventType),
  eventDate: z.string().trim().min(1, "Please choose an event date.").max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Please choose a valid date."),
  location: requiredText(3, 300, "Please enter the event location."),
  guestCount: numberInput(z.number().int().min(10, "Events require at least 10 guests.").max(100000)),
  packageId: optionalId,
  notes: optionalText(2000),
  idempotencyKey,
  services: z.array(bookingServiceSchema).max(50).default([]),
}).strict().superRefine((data, ctx) => {
  if (!data.packageId && data.services.length === 0) ctx.addIssue({ code: "custom", path: ["services"], message: "Choose a package or at least one service." });
});

export const paymentSchema = z.object({
  bookingId: idSchema,
  amount: moneyInput(100000000),
  stage: z.nativeEnum(PaymentStage),
  method: z.nativeEnum(PaymentMethod),
  reference: optionalText(200),
  idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/, "Invalid idempotency key."),
}).strict();

export const packageSchema = z.object({
  name: requiredText(2, 120, "Package name is required."),
  description: requiredText(10, 2000, "Add a short package description."),
  price: moneyInput(100000000),
  imageUrl: cloudinaryImageUrl,
  imagePublicId: cloudinaryPublicId,
  serviceIds: z.array(idSchema).min(1, "Select at least one service.").max(100),
}).strict();

export const packageUpdateSchema = packageSchema.extend({ id: idSchema });

export const serviceSchema = z.object({
  name: requiredText(2, 120, "Service name is required."),
  description: optionalText(500),
  basePrice: moneyInput(100000000),
  unitLabel: z.string().trim().min(1).max(30).default("unit"),
  pricingMode: z.nativeEnum(PricingMode).default("FIXED"),
  inventoryCategory: z.nativeEnum(InventoryCategory).optional().nullable(),
  imageUrl: cloudinaryImageUrl,
  imagePublicId: cloudinaryPublicId,
}).strict();

export const serviceUpdateSchema = serviceSchema.extend({ id: idSchema });

export const inventorySchema = z.object({
  name: requiredText(2, 120, "Inventory name is required."),
  category: z.nativeEnum(InventoryCategory),
  totalQuantity: numberInput(z.number().int().min(0, "Quantity cannot be negative.").max(100000000)),
  bookedQuantity: numberInput(z.number().int().min(0).max(100000000)).optional().default(0),
  reorderLevel: numberInput(z.number().int().min(0).max(100000000)).default(5),
  imageUrl: cloudinaryImageUrl,
  imagePublicId: cloudinaryPublicId,
}).strict();

export const inventoryUpdateSchema = inventorySchema.extend({ id: idSchema });

export const staffSchema = z.object({
  firstName: requiredText(2, 80, "First name is required."),
  lastName: optionalText(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  staffType: z.nativeEnum(StaffType),
}).strict();

export const staffUpdateSchema = z.object({ id: idSchema, isAvailable: z.boolean() }).strict();

export const adminRequestSchema = z.object({
  firstName: requiredText(2, 80, "First name is required."),
  lastName: optionalText(80),
  email: z.string().trim().toLowerCase().email().max(254),
  requestedRole: z.enum(["ADMIN", "STAFF"]),
  note: optionalText(1000),
}).strict();

export const businessSettingsSchema = z.object({
  businessName: requiredText(2, 120, "Business name is required."),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: phoneSchema,
  address: requiredText(3, 300, "Address is required."),
  city: requiredText(2, 120, "City is required."),
  taxRate: numberInput(z.number().min(0).max(1).multipleOf(0.01)),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
}).strict();

export const eventSchema = z.object({
  bookingId: idSchema,
  title: requiredText(2, 200, "Event title is required."),
  startDate: z.string().trim().min(1).max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid start date."),
  endDate: z.string().trim().min(1).max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid end date."),
  location: requiredText(3, 300, "Location is required."),
}).strict();
