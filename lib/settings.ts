import "server-only";

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

/**
 * Business profile, read on nearly every screen.
 *
 * Every admin page, customer page, invoice, and public header needs at least the
 * business name, and the admin/customer layouts are dynamic, so an uncached read
 * put one Neon round trip in front of every navigation. The row changes only when
 * an administrator saves the settings screen, which invalidates the tag
 * (`BUSINESS_SETTINGS_TAG`) immediately.
 *
 * The value is mapped to plain JSON before caching: Prisma's Decimal and Date
 * prototypes do not survive the incremental cache, and a cached `taxRate` that
 * silently became a string is exactly the sort of bug this wrapper should not
 * introduce.
 */
export const BUSINESS_SETTINGS_TAG = "business-settings";

export type BusinessSettings = {
  businessName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  taxRate: number;
  currency: string;
  logoUrl: string | null;
};

const FALLBACK: BusinessSettings = {
  businessName: "Event Management",
  email: "",
  phone: "",
  address: "",
  city: "",
  taxRate: 0.18,
  currency: "INR",
  logoUrl: null,
};

const loadBusinessSettings = unstable_cache(
  async (): Promise<BusinessSettings> => {
    try {
      const row = await prisma.businessSetting.findUnique({ where: { id: "default" } });
      if (!row) return FALLBACK;
      return {
        businessName: row.businessName?.trim() || FALLBACK.businessName,
        email: row.email ?? "",
        phone: row.phone ?? "",
        address: row.address ?? "",
        city: row.city ?? "",
        taxRate: Number(row.taxRate),
        currency: row.currency || "INR",
        logoUrl: row.logoUrl,
      };
    } catch {
      return FALLBACK;
    }
  },
  ["business-settings"],
  { revalidate: 300, tags: [BUSINESS_SETTINGS_TAG] },
);

export function getBusinessSettings(): Promise<BusinessSettings> {
  return loadBusinessSettings();
}
