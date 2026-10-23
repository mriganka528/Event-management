import { BookingStatus } from "@prisma/client";

/**
 * Booking status colours.
 *
 * These used to be Tailwind palette literals copied into the admin list, the
 * admin detail, the customer dashboard, the customer booking, and the public
 * tracking page. The copies drifted (completed was near-black in one place and
 * grey in another), and the near-black badge disappeared into a dark surface.
 * Semantic tokens make the badge legible in both theme scopes and give every
 * screen the same meaning for the same status.
 */
export function bookingStatusBadgeClass(status: BookingStatus) {
  switch (status) {
    case BookingStatus.APPROVED:
      return "bg-[var(--success-soft)] text-[var(--success-text)]";
    case BookingStatus.PREPARING:
      return "bg-[var(--brand-soft)] text-[var(--brand-dark)]";
    case BookingStatus.COMPLETED:
      return "bg-[var(--surface-strong)] text-[var(--foreground)]";
    case BookingStatus.CANCELLED:
    case BookingStatus.REJECTED:
      return "bg-[var(--danger-soft)] text-[var(--danger-text)]";
    default:
      return "bg-[var(--warning-soft)] text-[var(--warning-text)]";
  }
}

export function bookingStatusLabel(status: BookingStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
