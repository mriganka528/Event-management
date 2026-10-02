import { EventType, PaymentMethod, PaymentStage, StaffType } from "@prisma/client";

export const EVENT_TYPES = [
  { label: "Wedding", value: EventType.WEDDING },
  { label: "Birthday", value: EventType.BIRTHDAY },
  { label: "Corporate event", value: EventType.CORPORATE },
  { label: "Party", value: EventType.PARTY },
  { label: "Other", value: EventType.OTHER },
];

export const SERVICE_QUANTITY_HINTS: Record<string, number> = {
  chairs: 1,
  tables: 1,
  catering: 1,
};

export const PAYMENT_METHODS = Object.values(PaymentMethod);
export const PAYMENT_STAGES = Object.values(PaymentStage);
export const STAFF_TYPES = Object.values(StaffType);
