import type { Package, Service } from "@prisma/client";

export const TAX_RATE = 0.18;

type SelectedService = {
  serviceId: string;
  quantity: number;
};

type ServiceWithPrice = Omit<Pick<Service, "id" | "name" | "slug" | "basePrice">, "basePrice"> & {
  basePrice: Service["basePrice"] | number | string;
  pricingMode?: Service["pricingMode"];
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates the customer-facing estimate from trusted database prices.
 *
 * The three modes differ only in what one unit of the line is:
 *
 *  - `FIXED` — the customer's quantity.
 *  - `PER_GUEST` — the guest count, which is why a 400-guest request is impossible
 *    on a 200-chair inventory.
 *  - `PER_DAY` — the customer's quantity *per day*, so a three-day function bills
 *    the daily rate three times and reserves the stock for each of those days.
 *    The quantity the customer picks is how many of the thing per day, not how
 *    many in total; that is what makes `quantity × durationDays` the line total
 *    and keeps the reservation honest.
 *
 * `durationDays` defaults to one so every existing caller, stored booking, and
 * API client that predates per-day pricing still prices a single-day event.
 */
export function calculateBookingPrice({
  pkg,
  services,
  selectedServices,
  guestCount,
  durationDays = 1,
  taxRate = TAX_RATE,
}: {
  pkg?: Pick<Package, "price"> | null;
  services: ServiceWithPrice[];
  selectedServices: SelectedService[];
  guestCount: number;
  durationDays?: number;
  taxRate?: number;
}) {
  const servicesMap = new Map(services.map((service) => [service.id, service]));
  const packagePrice = pkg ? Number(pkg.price) : 0;
  const days = Math.max(1, Math.round(Number.isFinite(durationDays) ? durationDays : 1));
  const uniqueSelectedServices = Array.from(
    new Map(selectedServices.map((item) => [item.serviceId, item])).values(),
  );

  const serviceLines = uniqueSelectedServices
    .map((item) => {
      const service = servicesMap.get(item.serviceId);
      if (!service) {
        return null;
      }

      const isPerGuestService =
        service.pricingMode === "PER_GUEST" || (service.pricingMode === undefined && ["chairs", "tables", "catering"].includes(service.slug));
      const quantity = service.pricingMode === "PER_DAY" ? item.quantity * days : isPerGuestService ? guestCount : item.quantity;
      const unitPrice = Number(service.basePrice);

      return {
        serviceId: service.id,
        name: service.name,
        quantity,
        unitPrice,
        totalPrice: roundMoney(unitPrice * quantity),
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line));


  const servicesTotal = roundMoney(
    serviceLines.reduce((sum, line) => sum + line.totalPrice, 0),
  );
  const subtotal = roundMoney(packagePrice + servicesTotal);
  const safeTaxRate = Number.isFinite(taxRate) ? Math.min(1, Math.max(0, taxRate)) : TAX_RATE;
  const taxAmount = roundMoney(subtotal * safeTaxRate);
  const totalAmount = roundMoney(subtotal + taxAmount);

  return {
    packagePrice,
    serviceLines,
    subtotal,
    taxAmount,
    totalAmount,
    balanceAmount: totalAmount,
  };
}
