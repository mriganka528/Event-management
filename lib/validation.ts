import { z } from "zod";
import {
  EventType,
  InventoryCategory,
  PaymentMethod,
  PaymentStage,
  PricingMode,
  StaffType,
} from "@prisma/client";
import { eventDayCount, MAX_EVENT_DAYS } from "@/lib/event-dates";

const optionalText = (max = 500) => z.string().trim().max(max).optional().or(z.literal(""));
const requiredText = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid control characters.");
const idSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid identifier.");
const optionalId = idSchema.optional().or(z.literal(""));
const idempotencyKey = z.string().trim().max(160).regex(/^[A-Za-z0-9._:-]+$/, "Invalid idempotency key.").optional().or(z.literal(""));
const phoneSchema = z.string().trim().min(8).max(20).regex(/^[+()\-\s0-9]+$/, "Enter a valid phone number.");
/**
 * An Indian mobile number: ten digits, optionally written with a leading 0 or
 * +91 country code. Deliberately stricter than the business profile's phone,
 * which may be a landline, and stricter than the previous "8 to 20 characters
 * of digits" rule that let a booking through with any length at all.
 */
const customerPhoneSchema = z
  .string()
  .trim()
  .min(10, "Enter a 10-digit mobile number.")
  .max(16, "Enter a 10-digit mobile number.")
  .regex(/^[+()\-\s0-9]+$/, "Enter a valid mobile number.")
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 10 || (digits.length === 11 && digits.startsWith("0")) || (digits.length === 12 && digits.startsWith("91"));
  }, "Enter a 10-digit mobile number, with +91 if you use a country code.");
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
  customerPhone: customerPhoneSchema,
  customerAddress: optionalText(300),
  eventType: z.nativeEnum(EventType),
  eventDate: z.string().trim().min(1, "Please choose an event date.").max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Please choose a valid date."),
  /**
   * The last day of the event.
   *
   * Optional, and the range it describes is inclusive: the same start and end
   * is one day. An event that runs from the 12th to the 14th is three days.
   *
   * The customer picks a range rather than a day count, because a day count
   * and a date range can disagree, and only one of them can be checked
   * against a calendar.
   */
  eventEndDate: z
    .string()
    .trim()
    .max(40)
    .refine((value) => value === "" || !Number.isNaN(new Date(value).getTime()), "Please choose a valid end date.")
    .optional()
    .or(z.literal("")),
  location: requiredText(3, 300, "Please enter the event location."),
  guestCount: numberInput(z.number().int().min(10, "Events require at least 10 guests.").max(100000)),
  // Defaults to a single day, so a request that predates per-day pricing — or one
  // that only buys fixed and per-guest services — is still a valid body. Only
  // `PER_DAY` services read it.
  durationDays: numberInput(z.number().int().min(1).max(60, "An event cannot run for more than 60 days.")).default(1),
  packageId: optionalId,
  notes: optionalText(2000),
  idempotencyKey,
  services: z.array(bookingServiceSchema).max(50).default([]),
}).strict().superRefine((data, ctx) => {
  if (!data.packageId && data.services.length === 0) ctx.addIssue({ code: "custom", path: ["services"], message: "Choose a package or at least one service." });
  if (!data.eventEndDate) return;
  const days = eventDayCount(data.eventDate, data.eventEndDate);
  if (days === null) {
    ctx.addIssue({ code: "custom", path: ["eventEndDate"], message: "The end date must be on or after the start date." });
    return;
  }
  if (days > MAX_EVENT_DAYS) {
    ctx.addIssue({ code: "custom", path: ["eventEndDate"], message: `An event cannot run for more than ${MAX_EVENT_DAYS} days.` });
  }
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
  /**
   * Every stock category this service draws on, not one. A table-and-chair
   * arrangement needs both, and a line that claimed only one of them would let a
   * booking through against 200 chairs with no tables in the building. Re-read
   * from the form rather than trusted, so a hand-crafted request cannot attach a
   * category that is not a real one.
   */
  inventoryCategories: z.array(z.nativeEnum(InventoryCategory)).max(12, "A service cannot draw on that many stock categories.").default([]),
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

/**
 * `staffType` is optional because the availability toggle and the role selector
 * are posted by different forms. When it is present it must be a real
 * `StaffType`; the enum is re-checked here rather than trusted from the form so
 * a hand-crafted request cannot set an arbitrary string.
 */
export const staffUpdateSchema = z
  .object({
    id: idSchema,
    isAvailable: z.boolean().optional(),
    staffType: z.nativeEnum(StaffType).optional(),
  })
  .strict()
  .refine((value) => value.isAvailable !== undefined || value.staffType !== undefined, {
    message: "Nothing to update.",
  });

export const adminRequestSchema = z.object({
  firstName: requiredText(2, 80, "First name is required."),
  lastName: optionalText(80),
  email: z.string().trim().toLowerCase().email().max(254),
  requestedRole: z.enum(["ADMIN", "STAFF"]),
  /**
   * The role the applicant is asking for. Carried through to the reviewer
   * rather than being left blank, so a driver application cannot be approved as
   * a decorator because nobody was shown what was requested.
   */
  staffType: z.nativeEnum(StaffType).optional().nullable(),
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
  // Optional, and validated exactly like every other image: the URL has to be a
  // Cloudinary delivery address and the `publicId` has to agree with it, so the
  // logo cannot be pointed at somebody else's asset or a hand-typed address. The
  // pair is checked together in `assertCloudinaryAssetPair`, which is why both are
  // optional here rather than one being required.
  logoUrl: cloudinaryImageUrl,
  logoPublicId: cloudinaryPublicId,
}).strict();

export const eventSchema = z.object({
  bookingId: idSchema,
  title: requiredText(2, 200, "Event title is required."),
  startDate: z.string().trim().min(1).max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid start date."),
  endDate: z.string().trim().min(1).max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid end date."),
  location: requiredText(3, 300, "Location is required."),
}).strict();
