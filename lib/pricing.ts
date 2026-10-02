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
 * Quantities for per-person services are always based on the guest count;
 * fixed setup services use the quantity selected by the customer.
 */
export function calculateBookingPrice({
  pkg,
  services,
  selectedServices,
  guestCount,
  taxRate = TAX_RATE,
}: {
  pkg?: Pick<Package, "price"> | null;
  services: ServiceWithPrice[];
  selectedServices: SelectedService[];
  guestCount: number;
  taxRate?: number;
}) {
  const servicesMap = new Map(services.map((service) => [service.id, service]));
  const packagePrice = pkg ? Number(pkg.price) : 0;
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
      const quantity = isPerGuestService ? guestCount : item.quantity;
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
