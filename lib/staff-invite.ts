import { absoluteUrl } from "@/lib/site";

export const STAFF_INVITE_TTL_DAYS = 7;

export function staffInviteUrl(token: string) {
  return absoluteUrl(`/staff/invite/${token}`);
}

export function staffInviteExpiresAt(now = new Date()) {
  return new Date(now.getTime() + STAFF_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isStaffInviteExpired(expiresAt: Date | null | undefined, now = new Date()) {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

export function humanStaffType(staffType: string) {
  return staffType.charAt(0) + staffType.slice(1).toLowerCase().replaceAll("_", " ");
}
