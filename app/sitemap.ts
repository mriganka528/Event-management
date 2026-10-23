import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [packages, services] = await Promise.all([
    prisma.package.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }).catch(() => []),
    prisma.service.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }).catch(() => []),
  ]);
  return [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/packages"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/services"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/terms"), lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/customer/bookings/new"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    ...packages.map((item) => ({ url: absoluteUrl(`/packages/${item.slug}`), lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...services.map((item) => ({ url: absoluteUrl(`/services/${item.slug}`), lastModified: item.updatedAt, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
