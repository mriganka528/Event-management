import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/server";
import { calculateBookingPrice } from "@/lib/pricing";
import { bookingSchema, eventSchema, paymentSchema } from "@/lib/validation";
import { emitAdminEvent, emitUserEvent, emitUserNotification } from "@/lib/realtime";
import { emitExistingNotifications, notifyAdmins, notifyAdminsSafely } from "@/lib/notifications";
import { capacityByCategory, capacityShortfallMessage, collectInventoryRequirements, formatInventoryCategory, type CapacityView, type InventoryRequirementLine } from "@/lib/inventory";
import { withSerializableRetry } from "@/lib/transactions";
import { isSignInlessCustomerRecord } from "@/lib/access-policy";
import { eventDayCount, MAX_EVENT_DAYS } from "@/lib/event-dates";
import { istStartOfDay, parseIstLocalInput } from "@/lib/ist";
import { getBusinessSettings } from "@/lib/settings";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { failPendingCashClaims } from "@/lib/cash-payments";
import { CUSTOMER_USER_FIELDS, STAFF_USER_FIELDS } from "@/lib/user-fields";
import { sendBookingRequestEmail, sendBookingStatusEmail, sendPaymentReceivedEmail } from "@/lib/mailer";
import { absoluteUrl } from "@/lib/site";
import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { Prisma, AccountStatus, BookingStatus, Inventory, InventoryCategory, NotificationAudience, NotificationType, Package, PackageService, PaymentMethod, PaymentOrderStatus, PaymentStatus, RoleKey, Service } from "@prisma/client";





const bookingInclude = {
    customer: {
        include: {
            user: { select: CUSTOMER_USER_FIELDS }
        }
    },
    package: true,
    bookingServices: {
        include: {
            service: true
        }
    },
    bookingInventory: {
        include: {
            inventory: true
        }
    },
    bookingStaff: {
        include: {
            staff: {
                include: {
                    user: { select: STAFF_USER_FIELDS }
                }
            }
        }
    },
    payments: {
        orderBy: {
            paidAt: "desc"
        }
    },
    invoice: true,
    event: true
} satisfies Prisma.BookingInclude;
/**
 * Everything approval used to look up again and again.
 *
 * Approval used to fetch the booking, then the booking again for inventory,
 * then the customer and the booking again for the calendar event, then the
 * booking yet again for the invoice, and finally the whole booking once more
 * for the response. On a remote database those were eight sequential round
 * trips before the first inventory row moved. One join-shaped read hands every
 * helper the data it needs, and serializable isolation still protects the
 * write transaction.
 */ const approvalBookingInclude = {
    customer: {
        include: {
            user: { select: CUSTOMER_USER_FIELDS }
        }
    },
    package: {
        include: {
            packageServices: {
                include: {
                    service: true
                }
            }
        }
    },
    bookingServices: {
        include: {
            service: true
        }
    },
    bookingInventory: {
        select: {
            id: true
        }
    },
    event: {
        select: {
            id: true
        }
    }
} satisfies Prisma.BookingInclude;

/**
 * The booking shape the approval and reservation helpers work with.
 *
 * One read hands every helper the data it needs, and serializable isolation
 * still protects the write transaction.
 */
type ApprovalBooking = Prisma.BookingGetPayload<{ include: typeof approvalBookingInclude }>;
type LowStockAlert = { title: string; message: string };

/**
 * The shape the booking form reads.
 *
 * The form needs the catalog and the same per-category capacity the
 * reservation logic competes over, so the stepper can stop at the real limit
 * and warn before the customer submits a request the server is going to
 * refuse.
 */
export type BookingFormData = {
    services: Service[];
    packages: (Package & { packageServices: (PackageService & { service: Service })[] })[];
    inventory: Pick<Inventory, "id" | "name" | "category" | "availableQuantity" | "reorderLevel" | "isActive">[];
    capacity: Record<string, CapacityView>;
};

export const getBookingFormData = cache(async (): Promise<BookingFormData> => {
    const [services, packages, inventory] = await Promise.all([
        prisma.service.findMany({
            where: {
                isActive: true
            },
            orderBy: {
                name: "asc"
            }
        }),
        prisma.package.findMany({
            where: {
                isActive: true,
                packageServices: {
                    some: {
                        service: {
                            isActive: true
                        }
                    }
                }
            },
            include: {
                packageServices: {
                    where: {
                        service: {
                            isActive: true
                        }
                    },
                    include: {
                        service: true
                    }
                }
            },
            orderBy: {
                price: "asc"
            }
        }),
        prisma.inventory.findMany({
            where: {
                isActive: true
            },
            select: {
                id: true,
                name: true,
                category: true,
                availableQuantity: true,
                reorderLevel: true,
                isActive: true
            },
            orderBy: {
                availableQuantity: "asc"
            }
        })
    ]);
    // The booking form needs the same numbers the reservation logic competes
    // over, so the stepper can stop at the real limit and warn before the
    // customer submits a request the server is going to refuse.
    return {
        services,
        packages,
        inventory,
        capacity: capacityByCategory(inventory)
    };
});
export async function getBookingById(id: string) {
    return prisma.booking.findUnique({
        where: {
            id
        },
        include: bookingInclude,
        relationLoadStrategy: "join"
    });
}
export async function getBookingByIdForCustomer(id: string, customerId: string) {
    return prisma.booking.findFirst({
        where: {
            id,
            customerId
        },
        include: bookingInclude,
        relationLoadStrategy: "join"
    });
}
function bookingIdempotencyHash(data: { customerEmail: string; eventType: string; eventDate: string; eventEndDate?: string | null; location: string; guestCount: number; durationDays: number; packageId?: string | null; notes?: string | null; services: { serviceId: string }[] }) {
    return createHash("sha256").update(JSON.stringify({
        customerEmail: data.customerEmail.toLowerCase(),
        eventType: data.eventType,
        eventDate: data.eventDate,
        // The range is part of the request's identity. Two requests that differ
        // only in their end date are different bookings, and the second one must
        // not be swallowed as a replay of the first.
        eventEndDate: data.eventEndDate ?? null,
        location: data.location,
        guestCount: data.guestCount,
        durationDays: data.durationDays,
        packageId: data.packageId ?? null,
        notes: data.notes ?? "",
        services: [
            ...data.services
        ].sort((a, b)=>a.serviceId.localeCompare(b.serviceId))
    })).digest("hex");
}
async function getOrCreatePublicCustomer(payload: { customerName: string; customerEmail: string; customerPhone?: string | null; customerAddress?: string | null; userId?: string | null }, client: Prisma.TransactionClient | PrismaClient = prisma) {
    const [firstName, ...rest] = payload.customerName.trim().split(/\s+/);
    const lastName = rest.join(" ") || null;
    const email = payload.customerEmail.toLowerCase();
    const address = payload.customerAddress?.trim() || null;
    // A signed-in identity may only be linked to a local account that is already
    // approved. A pending, suspended, or rejected account must never acquire a
    // customer profile (and therefore booking history) through the public form.
    const existingBySession = payload.userId ? await client.user.findFirst({
        where: {
            id: payload.userId,
            isActive: true,
            accountStatus: AccountStatus.ACTIVE
        },
        include: {
            customerProfile: true,
            role: true
        }
    }) : null;
    // A signed-in account always keeps its own identity. The submitted email is
    // never allowed to move a session to a different user.
    if (existingBySession) {
        if (existingBySession.role.key !== RoleKey.CUSTOMER) {
            throw new Error("This account is reserved for administrators.");
        }
        /*
     * A signed-in customer used to return here after a single profile lookup,
     * so the phone number they had just typed into the booking form was thrown
     * away and every such booking waited forever with "Phone not provided".
     * The contact details on this form belong to the person submitting it, so
     * they are written back to the account before the profile is returned.
     */ if (existingBySession.firstName !== firstName || existingBySession.lastName !== lastName || existingBySession.phone !== payload.customerPhone) {
            await client.user.update({
                where: {
                    id: existingBySession.id
                },
                data: {
                    firstName,
                    lastName,
                    phone: payload.customerPhone
                }
            });
        }
        if (!existingBySession.customerProfile) {
            const profile = await client.customer.create({
                data: {
                    userId: existingBySession.id,
                    address
                }
            });
            return profile.id;
        }
        if (address && existingBySession.customerProfile.address !== address) {
            await client.customer.update({
                where: {
                    id: existingBySession.customerProfile.id
                },
                data: {
                    address
                }
            });
        }
        return existingBySession.customerProfile.id;
    }
    const existingByEmail = await client.user.findUnique({
        where: {
            email
        },
        include: {
            customerProfile: true,
            role: true
        }
    });
    if (existingByEmail) {
        /*
     * Reached only by an authenticated team member entering a request on somebody's
     * behalf — an anonymous request is refused before any address is read, so
     * nothing here can be used to find out whose address is an account. That is
     * also why the role may be named: the actor has already proved who they are.
     *
     * An address that already belongs to an account is never re-pointed, and a
     * team account is never silently downgraded to a customer — unless there is
     * nothing behind the account to protect. `isSignInlessCustomerRecord` is what
     * tells the two apart, and it resolves through `isPasswordRequired` rather
     * than a second opinion on "has a login".
     */ if (!payload.userId && !isSignInlessCustomerRecord({
            ...existingByEmail,
            role: existingByEmail.role.key
        })) {
            // Which remedy is true depends on what kind of account it is, and the order
            // matters: telling somebody with a team account to "sign in" points them at
            // a customer flow that will never accept their address, and vice versa.
            if (existingByEmail.role.key !== RoleKey.CUSTOMER) {
                throw new Error("This email is reserved for an administrator account.");
            }
            throw new Error("This booking request could not be created. Sign in with the account email and try again.");
        }
        if (existingByEmail.role.key !== RoleKey.CUSTOMER) {
            throw new Error("This email is reserved for an administrator account.");
        }
        // A signed-in customer may keep their own contact details current.
        const updated = await client.user.update({
            where: {
                id: existingByEmail.id
            },
            data: { firstName, lastName, phone: payload.customerPhone },
            include: {
                customerProfile: true,
                role: true
            }
        });
        if (updated.customerProfile && address && updated.customerProfile.address !== address) {
            await client.customer.update({
                where: {
                    id: updated.customerProfile.id
                },
                data: { address }
            });
        }
        if (updated.customerProfile) return updated.customerProfile.id;
        const profile = await client.customer.create({
            data: {
                userId: updated.id,
                address
            }
        });
        return profile.id;
    }
    const customerRole = await client.role.findUniqueOrThrow({
        where: {
            key: RoleKey.CUSTOMER
        }
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
            customerProfile: {
                create: {
                    address
                }
            }
        },
        include: {
            customerProfile: true
        }
    });
    // The profile is created with the user, so it is always there. The
    // assertion is a type guard rather than a rule: there is nothing a
    // customer could do about it if it were not.
    if (!user.customerProfile) throw new Error("This account cannot take a booking request.");
    return user.customerProfile.id;
}
export async function createBookingForPublicCustomer(rawData: unknown) {
    const data = bookingSchema.parse(rawData);
    /*
     * The event date is a calendar day, not an instant.
     *
     * It is anchored to IST midnight so the day the customer typed is the day
     * that gets stored and shown — the same day whoever looks at it and
     * wherever the server is running. Reading it as UTC midnight would put a
     * booking on the previous day for half the day.
     */
    const eventDate = istStartOfDay(data.eventDate);
    if (!eventDate) throw new Error("Please choose a valid event date.");
    const today = istStartOfDay(new Date());
    if (today && eventDate < today) throw new Error("Event date must be today or later.");
    /*
     * The day count comes from the date range the customer picked.
     *
     * It used to be typed as a separate number, which meant the customer
     * could say "the 12th" and "three days" and be describing two different
     * events. The range is the one thing that can be checked against a
     * calendar, so it decides the length, and the day count follows from it.
     */
    const rangeDays = data.eventEndDate ? eventDayCount(data.eventDate, data.eventEndDate) : null;
    if (rangeDays !== null && rangeDays > MAX_EVENT_DAYS) {
      throw new Error(`An event cannot run for more than ${MAX_EVENT_DAYS} days.`);
    }
    const durationDays = rangeDays ?? data.durationDays;
    /*
   * A booking request has to arrive with an authenticated actor.
   *
   * Two things fall out of that, and the second is why it is checked before the
   * address is looked at rather than after.
   *
   * 1. The catalog — packages, services, prices, availability — stays public, and
   *    only the request needs an account. Browsing is not the sensitive act;
   *    committing somebody's name, phone, and event date to a booking history is.
   *
   * 2. The answer can no longer depend on the address. It used to: an unknown
   *    address created a customer and booked, an address with an account was told
   *    to sign in, and an address belonging to a team account was told *that* — so
   *    the form was an oracle for "who is an administrator here", answerable by
   *    anyone with a list of addresses. Refusing before the lookup means every
   *    anonymous request gets one identical answer whatever is typed into it, which
   *    is the same rule the sign-in and password-recovery screens already follow.
   */ const session = await getCurrentUser();
    if (!session) {
        throw new Error("Sign in or create a customer account to send this booking request.");
    }
    // A signed-in customer's session is the identity; a team member is entering the
    // request on somebody's behalf, so the address on the form is what links it.
    const isCustomerActor = session.role === RoleKey.CUSTOMER;
    const canLinkAccount = isCustomerActor;
    const selectedServiceIds = Array.from(new Set(data.services.map((service)=>service.serviceId)));
    const requestHash = data.idempotencyKey ? bookingIdempotencyHash({ ...data, durationDays }) : null;
    try {
        const booking = await withSerializableRetry(async (tx)=>{
            if (data.idempotencyKey) {
                const existing = await tx.booking.findUnique({
                    where: {
                        idempotencyKey: data.idempotencyKey
                    },
                    include: {
                        customer: {
                            include: {
                                user: { select: CUSTOMER_USER_FIELDS }
                            }
                        }
                    }
                });
                if (existing) {
                    if (existing.customer.user.email.toLowerCase() !== data.customerEmail.toLowerCase() || existing.idempotencyHash && existing.idempotencyHash !== requestHash) throw new Error("That idempotency key was already used for a different booking request.");
                    return {
                        booking: existing,
                        notifications: [],
                        createdNow: false,
                        packageName: null,
                        serviceLines: []
                    };
                }
            }
            const [services, pkg, settings] = await Promise.all([
                tx.service.findMany({
                    where: {
                        id: {
                            in: selectedServiceIds
                        },
                        isActive: true
                    }
                }),
                data.packageId ? tx.package.findFirst({
                    where: {
                        id: data.packageId,
                        isActive: true,
                        packageServices: {
                            some: {
                                service: {
                                    isActive: true
                                }
                            }
                        }
                    },
                    include: {
                        packageServices: {
                            where: {
                                service: {
                                    isActive: true
                                }
                            },
                            include: {
                                service: true
                            }
                        }
                    }
                }) : null,
                tx.businessSetting.findUnique({
                    where: {
                        id: "default"
                    },
                    select: {
                        taxRate: true
                    }
                })
            ]);
            if (selectedServiceIds.length > 0 && services.length !== selectedServiceIds.length) throw new Error("One or more selected services are no longer available.");
            if (data.packageId && !pkg) throw new Error("The selected package is no longer available.");
            const pricing = calculateBookingPrice({
                pkg,
                services,
                selectedServices: data.services,
                guestCount: data.guestCount,
                durationDays,
                taxRate: settings ? Number(settings.taxRate) : undefined
            });
            if (!Number.isFinite(pricing.totalAmount) || pricing.totalAmount > 100000000) throw new Error("The booking quote is too large. Please contact our team for a custom proposal.");
            if (pricing.subtotal <= 0) throw new Error("Choose a package or service before sending the request.");
            // Stock is checked before the request is accepted. Waiting until approval
            // meant a customer could be told their event was confirmed by an admin
            // and then have it rejected because the chairs were already gone.
            const serviceById = new Map(services.map((service)=>[
                    service.id,
                    service
                ]));
            await assertInventoryCapacity(tx, collectInventoryRequirements({
                guestCount: data.guestCount,
                durationDays,
                serviceLines: pricing.serviceLines.map((line: { serviceId: string; quantity: number })=>({
                        inventoryCategories: serviceById.get(line.serviceId)?.inventoryCategories ?? [],
                        quantity: line.quantity
                    })),
                packageLines: pkg?.packageServices.map((entry)=>({
                        quantity: entry.quantity,
                        pricingMode: entry.service.pricingMode,
                        inventoryCategories: entry.service.inventoryCategories
                    })) ?? []
            }));
            const customerId = await getOrCreatePublicCustomer({
                customerName: data.customerName,
                customerEmail: data.customerEmail,
                customerPhone: data.customerPhone,
                customerAddress: data.customerAddress,
                userId: canLinkAccount ? session.id : undefined
            }, tx);
            const packageSnapshot = pkg?.packageServices.map((entry)=>({
                    serviceId: entry.serviceId,
                    name: entry.service.name,
                    quantity: entry.quantity,
                    pricingMode: entry.service.pricingMode,
                    inventoryCategories: entry.service.inventoryCategories
                })) ?? null;
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
                    durationDays,
                    notes: data.notes || null,
                    subtotal: pricing.subtotal,
                    taxAmount: pricing.taxAmount,
                    totalAmount: pricing.totalAmount,
                    balanceAmount: pricing.balanceAmount,
                    idempotencyKey: data.idempotencyKey || null,
                    idempotencyHash: requestHash,
                    publicToken: randomUUID(),
                    publicTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    bookingServices: {
                        create: pricing.serviceLines.map((line)=>({
                                serviceId: line.serviceId,
                                quantity: line.quantity,
                                unitPrice: line.unitPrice,
                                totalPrice: line.totalPrice
                            }))
                    }
                },
                include: {
                    customer: {
                        include: {
                            user: { select: CUSTOMER_USER_FIELDS }
                        }
                    }
                }
            });
            const admins = await tx.user.findMany({
                where: {
                    isActive: true,
                    accountStatus: AccountStatus.ACTIVE,
                    role: {
                        key: {
                            in: [
                                RoleKey.SUPER_ADMIN,
                                RoleKey.ADMIN
                            ]
                        }
                    }
                },
                select: {
                    id: true
                }
            });
            let bookingNotifications: Array<{ id: string; title: string; message: string; type: NotificationType; read: boolean; createdAt: Date; href: string | null }> = [];
            if (admins.length > 0) {
                const title = "New booking request";
                const message = `${created.customer.user.firstName} requested a ${created.eventType.toLowerCase()} booking for ${created.location}.`;
                await tx.notification.createMany({
                    data: admins.map((admin)=>({
                            userId: admin.id,
                            audience: NotificationAudience.ADMIN,
                            type: NotificationType.NEW_BOOKING_REQUEST,
                            title,
                            message,
                            // The pending queue, so the notification leads to the
                            // request waiting for a decision.
                            href: "/admin/bookings?status=PENDING"
                        }))
                });
                bookingNotifications = await tx.notification.findMany({
                    where: {
                        userId: {
                            in: admins.map((admin)=>admin.id)
                        },
                        type: NotificationType.NEW_BOOKING_REQUEST,
                        title,
                        message
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                });
            }
            return {
                booking: created,
                notifications: bookingNotifications,
                createdNow: true,
                packageName: pkg?.name ?? null,
                // Names are read here, inside the transaction, because the email
                // leaves after the commit and the catalog could change in between.
                serviceLines: pricing.serviceLines.map((line: {
                    serviceId: string;
                    quantity: number;
                })=>({
                        name: serviceById.get(line.serviceId)?.name ?? "Service",
                        quantity: line.quantity
                    }))
            };
        });
        emitAdminEvent("booking.created", {
            entityId: booking.booking.id,
            action: "created"
        });
        emitUserEvent(booking.booking.customer.user.id, "booking.created", {
            entityId: booking.booking.id,
            action: "created"
        });
        emitExistingNotifications(booking.notifications, "/admin/bookings?status=PENDING");
        if (booking.createdNow) {
            const customer = booking.booking.customer.user;
            const bookingId = booking.booking.id;
            await sendBookingRequestEmail({
                to: customer.email,
                firstName: customer.firstName,
                reference: bookingId.slice(0, 8).toUpperCase(),
                eventType: booking.booking.eventType,
                eventDate: booking.booking.eventDate,
                location: booking.booking.location,
                guestCount: booking.booking.guestCount,
                packageName: booking.packageName,
                services: booking.serviceLines,
                totalAmount: Number(booking.booking.totalAmount),
                // The public token works for every customer, including one a
                // team member entered on behalf of. A signed-in customer can
                // also reach the same booking from their dashboard.
                trackingUrl: booking.booking.publicToken ? absoluteUrl(`/customer/track?token=${encodeURIComponent(booking.booking.publicToken)}`) : absoluteUrl(`/customer/bookings/${bookingId}`)
            });
        }
        return booking.booking;
    } catch (error) {
        // A concurrent request may win the unique idempotency constraint between
        // the first read and commit. Return only the matching customer's winner.
        if (data.idempotencyKey) {
            const existing = await prisma.booking.findUnique({
                where: {
                    idempotencyKey: data.idempotencyKey
                },
                include: {
                    customer: {
                        include: {
                            user: { select: CUSTOMER_USER_FIELDS }
                        }
                    }
                }
            });
            if (existing && existing.customer.user.email.toLowerCase() === data.customerEmail.toLowerCase() && (!existing.idempotencyHash || existing.idempotencyHash === requestHash)) return existing;
        }
        throw error;
    }
}
export async function assertInventoryCapacity(client: Prisma.TransactionClient | PrismaClient, requirements: Map<string, number>) {
    for (const [category, required] of requirements){
        if (required <= 0) continue;
        const items = await client.inventory.findMany({
            where: {
                category: category as InventoryCategory,
                isActive: true
            },
            select: {
                availableQuantity: true
            }
        });
        if (items.length === 0) throw new Error(capacityShortfallMessage(category, required, 0));
        const available = items.reduce((sum: number, item: { availableQuantity: number })=>sum + Math.max(0, item.availableQuantity), 0);
        if (required > available) throw new Error(capacityShortfallMessage(category, required, available));
    }
}
async function reserveInventoryForBookingInTransaction(tx: Prisma.TransactionClient, bookingId: string, loaded?: ApprovalBooking) {
    const booking = loaded ?? await tx.booking.findUnique({
        where: {
            id: bookingId
        },
        include: {
            bookingServices: {
                include: {
                    service: true
                }
            },
            package: {
                include: {
                    packageServices: {
                        include: {
                            service: true
                        }
                    }
                }
            },
            bookingInventory: {
                select: {
                    id: true
                }
            }
        },
        relationLoadStrategy: "join"
    });
    if (!booking) throw new Error("Booking not found.");
    if (booking.bookingInventory.length > 0) return [];
    const requirements = collectInventoryRequirements({
        guestCount: booking.guestCount,
        durationDays: booking.durationDays,
        // `BookingService.quantity` already holds the unit count: pricing rewrites a
        // per-guest line to the guest count, and a per-day line to its day count,
        // before the row is written.
        serviceLines: booking.bookingServices.map((item)=>({
                inventoryCategories: item.service.inventoryCategories,
                quantity: item.quantity
            })),
        // The snapshot is preferred, so a package keeps the stock it was quoted with
        // even after the catalog is edited. `inventoryCategoriesOf` reads the older
        // single-category shape these rows can still be in.
        packageLines: (Array.isArray(booking.packageServicesSnapshot)
            ? (booking.packageServicesSnapshot as InventoryRequirementLine[])
            : booking.package?.packageServices.map((item)=>({
                    quantity: item.quantity,
                    pricingMode: item.service.pricingMode,
                    inventoryCategories: item.service.inventoryCategories
                })) ?? [])
    });
    if (requirements.size === 0) return [];
    // One read for every category instead of one read per category. The list is
    // still consumed per category, and each decrement remains conditional so two
    // approvals cannot claim the same last chair.
    const inventoryItems = await tx.inventory.findMany({
        where: {
            category: {
                in: Array.from(requirements.keys()) as InventoryCategory[]
            },
            isActive: true
        },
        orderBy: {
            availableQuantity: "desc"
        }
    });
    const itemsByCategory = new Map();
    for (const item of inventoryItems){
        const list = itemsByCategory.get(item.category) ?? [];
        list.push(item);
        itemsByCategory.set(item.category, list);
    }
    const lowInventoryNotifications = [];
    const allocations = [];
    for (const [category, requiredQuantity] of requirements){
        const items = itemsByCategory.get(category) ?? [];
        if (items.length === 0) throw new Error(`No inventory is configured for ${category.toLowerCase().replaceAll("_", " ")}.`);
        let remaining = requiredQuantity;
        for (const inventory of items){
            if (remaining <= 0) break;
            const quantity = Math.min(remaining, inventory.availableQuantity);
            if (quantity <= 0) continue;
            const updated = await tx.inventory.updateMany({
                where: {
                    id: inventory.id,
                    availableQuantity: {
                        gte: quantity
                    }
                },
                data: {
                    bookedQuantity: {
                        increment: quantity
                    },
                    availableQuantity: {
                        decrement: quantity
                    }
                }
            });
            if (updated.count !== 1) continue;
            allocations.push({
                inventoryId: inventory.id,
                quantity
            });
            remaining -= quantity;
            const after = inventory.availableQuantity - quantity;
            if (after <= inventory.reorderLevel) {
                lowInventoryNotifications.push({
                    title: after <= 0 ? "Out of stock" : "Low inventory alert",
                    message: after <= 0 ? `${inventory.name} is now fully reserved. Restock it before accepting more ${formatInventoryCategory(category).toLowerCase()} bookings.` : `${inventory.name} is low on stock: ${after} unit(s) left after reserving ${quantity}.`
                });
            }
        }
        if (remaining > 0) throw new Error(capacityShortfallMessage(category, requiredQuantity, requiredQuantity - remaining));
    }
    // The reservation rows are independent of each other; one INSERT beats one
    // round trip per allocated stock item.
    if (allocations.length > 0) {
        await tx.bookingInventory.createMany({
            data: allocations.map((allocation)=>({
                    bookingId,
                    inventoryId: allocation.inventoryId,
                    quantity: allocation.quantity
                }))
        });
    }
    return lowInventoryNotifications;
}
async function notifyLowStock(alerts: LowStockAlert[]) {
    if (alerts.length === 0) return;
    try {
        await notifyAdmins({
            type: NotificationType.LOW_INVENTORY,
            title: alerts.length === 1 ? alerts[0].title : `${alerts.length} inventory alerts`,
            message: alerts.map((alert)=>alert.message).join(" "),
            href: "/admin/inventory"
        });
    } catch (error) {
        // Approval has already committed. A notification outage must not turn a
        // successful reservation into an error the admin would retry.
        console.error("Low-stock notification failed.", error);
    }
}
export async function reserveInventoryForBooking(bookingId: string) {
    const alerts = await withSerializableRetry(async (tx)=>{
        const booking = await tx.booking.findUnique({
            where: {
                id: bookingId
            },
            include: {
                bookingServices: {
                    include: {
                        service: true
                    }
                },
                package: {
                    include: {
                        packageServices: {
                            include: {
                                service: true
                            }
                        }
                    }
                },
                bookingInventory: {
                    select: {
                        id: true
                    }
                }
            },
            relationLoadStrategy: "join"
        });
        if (!booking) throw new Error("Booking not found.");
        return reserveInventoryForBookingInTransaction(tx, bookingId, booking as unknown as ApprovalBooking);
    });
    await notifyLowStock(alerts);
}
async function releaseInventoryForBookingInTransaction(tx: Prisma.TransactionClient, bookingId: string) {
    const allocations = await tx.bookingInventory.findMany({
        where: {
            bookingId
        }
    });
    for (const allocation of allocations){
        const released = await tx.inventory.updateMany({
            where: {
                id: allocation.inventoryId,
                bookedQuantity: {
                    gte: allocation.quantity
                }
            },
            data: {
                bookedQuantity: {
                    decrement: allocation.quantity
                },
                availableQuantity: {
                    increment: allocation.quantity
                }
            }
        });
        if (released.count === 1) {
            const latest = await tx.inventory.findUnique({
                where: {
                    id: allocation.inventoryId
                },
                select: {
                    totalQuantity: true,
                    availableQuantity: true
                }
            });
            if (latest && latest.availableQuantity > latest.totalQuantity) await tx.inventory.update({
                where: {
                    id: allocation.inventoryId
                },
                data: {
                    availableQuantity: latest.totalQuantity
                }
            });
        }
    }
    if (allocations.length > 0) await tx.bookingInventory.deleteMany({
        where: {
            id: {
                in: allocations.map((allocation)=>allocation.id)
            }
        }
    });
}
export async function releaseInventoryForBooking(bookingId: string) {
    await withSerializableRetry((tx)=>releaseInventoryForBookingInTransaction(tx, bookingId));
}
async function upsertInvoiceForBooking(client: Prisma.TransactionClient | PrismaClient, booking: { id: string; subtotal: Prisma.Decimal | number; taxAmount: Prisma.Decimal | number; totalAmount: Prisma.Decimal | number; balanceAmount: Prisma.Decimal | number; paidAmount: Prisma.Decimal | number }) {
    const taxRate = Number(booking.subtotal) > 0 ? Number(booking.taxAmount) / Number(booking.subtotal) : 0.18;
    return client.invoice.upsert({
        where: {
            bookingId: booking.id
        },
        update: {
            taxRate,
            totalAmount: booking.totalAmount,
            paidAmount: booking.paidAmount,
            balanceAmount: booking.balanceAmount
        },
        create: {
            bookingId: booking.id,
            invoiceNumber: `INV-${booking.id.slice(0, 8).toUpperCase()}`,
            taxRate,
            totalAmount: booking.totalAmount,
            paidAmount: booking.paidAmount,
            balanceAmount: booking.balanceAmount
        }
    });
}
export async function ensureInvoice(bookingId: string, client: Prisma.TransactionClient | PrismaClient = prisma): Promise<unknown> {
    if (client === prisma) return withSerializableRetry((tx)=>ensureInvoice(bookingId, tx));
    const booking = await client.booking.findUnique({
        where: {
            id: bookingId
        }
    });
    if (!booking) throw new Error("Booking not found.");
    const unInvoiceableStatuses: BookingStatus[] = [
        BookingStatus.PENDING,
        BookingStatus.CANCELLED,
        BookingStatus.REJECTED
    ];
    if (unInvoiceableStatuses.includes(booking.status)) {
        throw new Error("Invoices are available after a booking is approved.");
    }
    return upsertInvoiceForBooking(client, booking);
}
async function createEventForBookingInTransaction(client: Prisma.TransactionClient | PrismaClient, booking: { id: string; eventType: string; eventDate: Date; durationDays: number; location: string; customer: { user: { firstName: string; lastName: string | null } }; event?: { id: string } | null }) {
    /*
     * The calendar entry starts at IST midnight on the event's day.
     *
     * A booking written before the timezone was stated stores its date at UTC
     * midnight, which is half past five in the morning in India. Starting the
     * calendar entry there would put a morning event on the crew's list at
     * 05:30, so the day is taken from the stored value and the time from the
     * calendar itself. See `lib/ist.ts`.
     */
    const startDate = istStartOfDay(booking.eventDate) ?? booking.eventDate;
    /*
     * The calendar entry covers the whole event, not just its first day.
     *
     * A one-day event keeps the eight-hour window it always had. A longer one
     * runs to the end of its last day, so the operations calendar shows the
     * team that the ground is held for three days rather than one — which is
     * what decides whether two bookings can share the same crew.
     */
    const days = Math.max(1, Math.round(Number.isFinite(booking.durationDays) ? booking.durationDays : 1));
    const endDate = days > 1
        ? new Date(startDate.getTime() + (days - 1) * 86_400_000 + 8 * 60 * 60 * 1000)
        : new Date(startDate.getTime() + 8 * 60 * 60 * 1000);
    const title = `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""} ${booking.eventType}`.trim();
    const conflict = await client.event.findFirst({
        where: {
            id: booking.event ? {
                not: booking.event.id
            } : undefined,
            startDate: {
                lt: endDate
            },
            endDate: {
                gt: startDate
            }
        },
        select: {
            id: true
        }
    });
    if (conflict) throw new Error("That time overlaps another event on the operations calendar.");
    return client.event.upsert({
        where: {
            bookingId: booking.id
        },
        update: {
            title,
            startDate,
            endDate,
            location: booking.location
        },
        create: {
            bookingId: booking.id,
            title,
            startDate,
            endDate,
            location: booking.location
        }
    });
}
export async function createEventForBooking(bookingId: string, client: Prisma.TransactionClient | PrismaClient = prisma): Promise<unknown> {
    if (client === prisma) return withSerializableRetry((tx)=>createEventForBooking(bookingId, tx));
    const booking = await client.booking.findUnique({
        where: {
            id: bookingId
        },
        include: {
            customer: {
                include: {
                    user: { select: CUSTOMER_USER_FIELDS }
                }
            },
            event: {
                select: {
                    id: true
                }
            }
        },
        relationLoadStrategy: "join"
    });
    if (!booking) throw new Error("Booking not found.");
    return createEventForBookingInTransaction(client, booking);
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
    const openOrders = await tx.paymentOrder.findMany({
        where: {
            bookingId,
            status: PaymentOrderStatus.CREATED
        },
        select: {
            id: true,
            amount: true
        }
    });
    for (const order of openOrders){
        await tx.booking.updateMany({
            where: {
                id: bookingId,
                reservedPaymentAmount: {
                    gte: order.amount
                }
            },
            data: {
                reservedPaymentAmount: {
                    decrement: order.amount
                }
            }
        });
        await tx.paymentOrder.update({
            where: {
                id: order.id
            },
            data: {
                status: PaymentOrderStatus.FAILED
            }
        });
    }
}
export async function updateBookingStatus(bookingId: string, nextStatus: BookingStatus) {
    let lowStockAlerts: LowStockAlert[] = [];
    const result = await withSerializableRetry(async (tx)=>{
        lowStockAlerts = [];
        /*
     * One joined read supplies the customer, quoted services, package, current
     * event and inventory links. The old flow re-read the booking for every
     * helper and then read it once more just to build the response.
     */ const booking = await tx.booking.findUnique({
            where: {
                id: bookingId
            },
            include: approvalBookingInclude,
            relationLoadStrategy: "join"
        });
        if (!booking) throw new Error("Booking not found.");
        if (booking.status === nextStatus) return {
            booking,
            changed: false,
            eventDate: booking.eventDate,
            location: booking.location
        };
        if (nextStatus === BookingStatus.CANCELLED && Number(booking.paidAmount) > 0) throw new Error("A booking with a captured payment must be refunded before it can be cancelled.");
        if (nextStatus === BookingStatus.APPROVED) {
            // Both sides are IST calendar days, so a booking for today's date
            // can be approved until the day is actually over in India. See
            // `lib/ist.ts`.
            const today = istStartOfDay(new Date());
            const eventDay = istStartOfDay(booking.eventDate);
            if (today && eventDay && eventDay < today) throw new Error("Past event dates cannot be approved.");
        }
        if (!allowedStatusTransitions[booking.status].includes(nextStatus)) throw new Error(`A ${booking.status.toLowerCase()} booking cannot move to ${nextStatus.toLowerCase()}.`);
        const claimed = await tx.booking.updateMany({
            where: {
                id: bookingId,
                status: booking.status
            },
            data: {
                status: nextStatus
            }
        });
        if (claimed.count !== 1) throw new Error("This booking was updated by another user. Refresh and try again.");
        if (nextStatus === BookingStatus.APPROVED) {
            lowStockAlerts = await reserveInventoryForBookingInTransaction(tx, bookingId, booking);
            await createEventForBookingInTransaction(tx, booking);
            await upsertInvoiceForBooking(tx, booking);
        }
        const closingStatuses: BookingStatus[] = [
            BookingStatus.CANCELLED,
            BookingStatus.REJECTED,
            BookingStatus.COMPLETED
        ];
        if (closingStatuses.includes(nextStatus)) {
            await releasePaymentReservationsInTransaction(tx, bookingId);
            await releaseInventoryForBookingInTransaction(tx, bookingId);
        }
        const clearPaymentRequest = nextStatus === BookingStatus.CANCELLED || nextStatus === BookingStatus.REJECTED;
        if (clearPaymentRequest) {
            // A declined or cancelled booking cannot be paid, so an unpaid cash claim
            // must stop appearing as something the admin can approve.
            await tx.payment.updateMany({
                where: {
                    bookingId,
                    method: PaymentMethod.CASH,
                    status: PaymentStatus.PENDING
                },
                data: {
                    status: PaymentStatus.FAILED
                }
            });
            await tx.booking.update({
                where: {
                    id: bookingId
                },
                data: {
                    paymentRequestMode: null,
                    paymentRequestTargetAmount: null,
                    paymentRequestedAt: null
                }
            });
        }
        const notificationType = nextStatus === BookingStatus.APPROVED ? NotificationType.BOOKING_APPROVED : nextStatus === BookingStatus.REJECTED ? NotificationType.BOOKING_REJECTED : NotificationType.EVENT_REMINDER;
        const title = nextStatus === BookingStatus.APPROVED ? "Booking approved" : nextStatus === BookingStatus.REJECTED ? "Booking request declined" : `Booking ${nextStatus.toLowerCase()}`;
        const statusNotification = await tx.notification.create({
            data: {
                userId: booking.customer.user.id,
                audience: NotificationAudience.CUSTOMER,
                type: notificationType,
                title,
                message: `Your booking for ${booking.location} is now ${nextStatus.toLowerCase()}.`,
                // The booking itself, so the notification leads to the thing it
                // is about rather than to a list the customer has to search.
                href: `/customer/bookings/${booking.id}`
            }
        });
        // Build the response from the row already in memory. Relation keys are
        // removed but every booking column stays, matching the shape the previous
        // findUnique returned.
        const { customer, ...joinedBooking } = booking;
        const bookingFields = Object.fromEntries(Object.entries(joinedBooking).filter(([key])=>![
                "package",
                "bookingServices",
                "bookingInventory",
                "event"
            ].includes(key)));
        const updated = {
            ...bookingFields,
            status: nextStatus,
            customer,
            ...clearPaymentRequest ? {
                paymentRequestMode: null,
                paymentRequestTargetAmount: null,
                paymentRequestedAt: null
            } : {}
        };
        return {
            booking: updated,
            changed: true,
            statusNotification,
            eventDate: booking.eventDate,
            location: booking.location
        };
    });
    if (result.changed) {
        emitAdminEvent("booking.updated", {
            entityId: bookingId,
            action: nextStatus.toLowerCase()
        });
        emitUserEvent(result.booking.customer.user.id, "booking.updated", {
            entityId: bookingId,
            action: nextStatus.toLowerCase()
        });
        if (result.statusNotification) emitUserNotification(result.booking.customer.user.id, result.statusNotification, `/customer/bookings/${bookingId}`);
        // Every status change is a customer-facing update: approved, declined,
        // preparing, completed, and cancelled all have their own copy in the
        // mailer. The in-app notification above is created in the same pass.
        await sendBookingStatusEmail({
            to: result.booking.customer.user.email,
            firstName: result.booking.customer.user.firstName,
            reference: bookingId.slice(0, 8).toUpperCase(),
            status: nextStatus,
            eventDate: result.eventDate,
            location: result.location,
            bookingUrl: absoluteUrl(`/customer/bookings/${bookingId}`)
        });
    }
    // Notifications go through the standalone client after the transaction has
    // committed, so a notification failure can never roll back a reservation.
    await notifyLowStock(lowStockAlerts);
    return result.booking;
}
export async function createPayment(rawData: unknown) {
    const data = paymentSchema.parse(rawData);
    const amount = Math.round((data.amount + Number.EPSILON) * 100) / 100;
    const idempotencyKey = data.idempotencyKey;
    const result = await withSerializableRetry(async (tx)=>{
        if (idempotencyKey) {
            const existing = await tx.payment.findUnique({
                where: {
                    idempotencyKey
                }
            });
            if (existing) {
                if (existing.bookingId !== data.bookingId || Number(existing.amount) !== amount || existing.stage !== data.stage || existing.method !== data.method || (existing.reference ?? null) !== (data.reference || null)) throw new Error("That idempotency key was already used for another payment.");
                return {
                    payment: existing,
                    customerId: null,
                    amount: Number(existing.amount),
                    customerEmail: null,
                    customerFirstName: null,
                    customerName: null,
                    balanceAmount: null
                };
            }
        }
        const booking = await tx.booking.findUnique({
            where: {
                id: data.bookingId
            },
            include: {
                customer: {
                    include: {
                        user: { select: CUSTOMER_USER_FIELDS }
                    }
                },
                invoice: true
            }
        });
        if (!booking) throw new Error("Booking not found.");
        if (amount <= 0) throw new Error("Payment amount must be at least 0.01.");
        const payableStatuses: BookingStatus[] = [
            BookingStatus.APPROVED,
            BookingStatus.PREPARING,
            BookingStatus.COMPLETED
        ];
        if (!payableStatuses.includes(booking.status)) throw new Error("Payments can be recorded after the booking is approved.");
        const available = Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount);
        if (amount > available) throw new Error("Payment cannot be greater than the currently available balance.");
        const updated = await tx.booking.updateMany({
            where: {
                id: booking.id,
                balanceAmount: {
                    gte: amount
                },
                status: {
                    in: payableStatuses
                }
            },
            data: {
                paidAmount: {
                    increment: amount
                },
                balanceAmount: {
                    decrement: amount
                }
            }
        });
        if (updated.count !== 1) throw new Error("The booking balance changed. Refresh and try again.");
        const after = await tx.booking.findUniqueOrThrow({
            where: {
                id: booking.id
            },
            select: {
                paidAmount: true,
                balanceAmount: true
            }
        });
        const created = await tx.payment.create({
            data: {
                bookingId: booking.id,
                amount,
                stage: data.stage,
                method: data.method,
                provider: "MANUAL",
                status: "CAPTURED",
                reference: data.reference || null,
                idempotencyKey: idempotencyKey || null
            }
        });
        // A recorded cash/UPI/card payment settles the booking, so an older unpaid
        // customer cash claim can no longer be approved.
        await failPendingCashClaims(tx, booking.id);
        await tx.invoice.upsert({
            where: {
                bookingId: booking.id
            },
            update: {
                paidAmount: after.paidAmount,
                balanceAmount: after.balanceAmount
            },
            create: {
                bookingId: booking.id,
                invoiceNumber: `INV-${booking.id.slice(0, 8).toUpperCase()}`,
                taxRate: Number(booking.taxAmount) > 0 ? Number(booking.taxAmount) / Number(booking.subtotal) : 0.18,
                totalAmount: booking.totalAmount,
                paidAmount: after.paidAmount,
                balanceAmount: after.balanceAmount
            }
        });
        const paymentNotification = await tx.notification.create({
            data: {
                userId: booking.customer.user.id,
                audience: NotificationAudience.CUSTOMER,
                type: NotificationType.PAYMENT_RECEIVED,
                title: "Payment received",
                message: `We recorded a payment of ₹${amount.toLocaleString("en-IN")} for your booking.`,
                // The booking, so the customer can see what the money was for.
                href: `/customer/bookings/${booking.id}`
            }
        });
        return {
            payment: created,
            customerId: booking.customer.user.id,
            amount,
            paymentNotification,
            customerEmail: booking.customer.user.email,
            customerFirstName: booking.customer.user.firstName,
            customerName: [booking.customer.user.firstName, booking.customer.user.lastName].filter(Boolean).join(" "),
            balanceAmount: Number(after.balanceAmount)
        };
    });
    if (result.customerId) {
        // This is the same alert path as a customer-initiated payment, so a
        // manually recorded instalment still reaches every admin's bell,
        // toast, chime, and browser notification.
        await notifyAdminsSafely({
            type: NotificationType.PAYMENT_RECEIVED,
            title: "Manual payment recorded",
            message: `${result.customerName || "A customer"} paid ₹${result.amount.toLocaleString("en-IN")} for booking ${result.payment.bookingId.slice(0, 8).toUpperCase()}. Remaining balance ₹${(result.balanceAmount ?? 0).toLocaleString("en-IN")}.`,
            href: `/admin/bookings/${result.payment.bookingId}`
        });
        emitAdminEvent("payment.recorded", {
            entityId: result.payment.bookingId,
            action: "manual"
        });
        emitUserEvent(result.customerId, "payment.recorded", {
            entityId: result.payment.bookingId,
            action: "manual"
        });
        if (result.paymentNotification) emitUserNotification(result.customerId, result.paymentNotification, `/customer/bookings/${result.payment.bookingId}`);
        if (result.customerEmail) {
            await sendPaymentReceivedEmail({
                to: result.customerEmail,
                firstName: result.customerFirstName ?? "",
                reference: result.payment.bookingId.slice(0, 8).toUpperCase(),
                amount: result.amount,
                balanceAmount: result.balanceAmount ?? 0,
                bookingUrl: absoluteUrl(`/customer/bookings/${result.payment.bookingId}`)
            });
        }
    }
    return result.payment;
}
export async function createEvent(rawData: { bookingId: string; title: string; startDate: string; endDate: string; location: string }, client: Prisma.TransactionClient | PrismaClient = prisma): Promise<unknown> {
    if (client === prisma) return withSerializableRetry((tx)=>createEvent(rawData, tx));
    const data = eventSchema.parse(rawData);
    /*
     * The admin's `datetime-local` fields carry wall clock time with no
     * timezone, and the business works in IST. Reading them in the server's
     * own timezone would save the event five and a half hours out on a UTC
     * host, so they are read as IST. See `lib/ist.ts`.
     */
    const startDate = parseIstLocalInput(data.startDate);
    const endDate = parseIstLocalInput(data.endDate);
    if (!startDate || !endDate) throw new Error("Enter a valid start and end time.");
    if (endDate <= startDate) throw new Error("Event end time must be after the start time.");
    const booking = await client.booking.findUnique({
        where: {
            id: data.bookingId
        },
        select: {
            status: true
        }
    });
    const connectableStatuses: BookingStatus[] = [
        BookingStatus.APPROVED,
        BookingStatus.PREPARING
    ];
    if (!booking || !connectableStatuses.includes(booking.status)) {
        throw new Error("Only approved bookings can be connected to the calendar.");
    }
    const existing = await client.event.findUnique({
        where: {
            bookingId: data.bookingId
        },
        select: {
            id: true
        }
    });
    const conflict = await client.event.findFirst({
        where: {
            id: existing ? {
                not: existing.id
            } : undefined,
            startDate: {
                lt: endDate
            },
            endDate: {
                gt: startDate
            }
        }
    });
    if (conflict) throw new Error("That time overlaps another event on the operations calendar.");
    return client.event.upsert({
        where: {
            bookingId: data.bookingId
        },
        update: {
            title: data.title,
            startDate,
            endDate,
            location: data.location
        },
        create: {
            bookingId: data.bookingId,
            title: data.title,
            startDate,
            endDate,
            location: data.location
        }
    });
}
export async function generateInvoicePdf(invoiceId: string) {
    const [invoice, settings] = await Promise.all([
        prisma.invoice.findUnique({
            where: {
                id: invoiceId
            },
            include: {
                booking: {
                    include: {
                        customer: {
                            include: {
                                user: { select: CUSTOMER_USER_FIELDS }
                            }
                        },
                        package: {
                            select: {
                                name: true,
                                price: true
                            }
                        },
                        bookingServices: {
                            include: {
                                service: true
                            }
                        },
                        payments: {
                            where: {
                                status: PaymentStatus.CAPTURED
                            },
                            orderBy: {
                                paidAt: "desc"
                            }
                        }
                    }
                }
            },
            relationLoadStrategy: "join"
        }),
        getBusinessSettings()
    ]);
    if (!invoice) throw new Error("Invoice not found.");
    return renderInvoicePdf(invoice, settings);
}
