"use client";

import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { Carousel } from "@/components/marketing/carousel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

export type PackageSlide = {
  id: string;
  name: string;
  price: number;
  description: string;
  image: string | null;
};

/**
 * The featured-packages carousel.
 *
 * This is a client component of its own rather than the landing page handing a
 * `renderItem` function to `Carousel`. A function cannot cross the server/client
 * boundary — only serialisable props can — so the markup has to live on this side
 * of it, and the page passes plain data:
 *
 *   Error: Functions cannot be passed directly to Client Components.
 *
 * `Carousel` keeps its render prop because that is a perfectly good API between
 * two client components; only the *caller* has to be one.
 */
export function PackageCarousel({ packages, currency }: { packages: PackageSlide[]; currency: string }) {
  return (
    <Carousel
      items={packages}
      renderItem={(item) => (
        <Card className="border-[var(--line)] bg-[var(--card)]">
          <div className="grid gap-0 lg:grid-cols-[1fr_0.95fr]">
            <div className="p-3">
              {item.image ? (
                <Image src={item.image} alt={item.name} width={1200} height={900} sizes="(min-width: 1024px) 45vw, 100vw" className="h-full min-h-80 w-full rounded-[28px] object-cover" />
              ) : (
                <div className="flex min-h-80 items-center justify-center rounded-[28px] bg-[var(--surface)] text-[var(--muted)]">No package image</div>
              )}
            </div>
            <CardContent className="flex flex-col justify-center space-y-5 p-8">
              <Badge className="w-fit bg-amber-100 text-amber-900">{item.name}</Badge>
              <p className="text-4xl text-[var(--foreground)]">{formatCurrency(item.price, currency)}</p>
              <p className="text-[var(--muted)]">{item.description}</p>
              <div className="space-y-2 text-sm text-[var(--foreground)]">
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-amber-500" /> Package details confirmed by your team
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-amber-500" /> Flexible add-ons for your event
                </p>
              </div>
            </CardContent>
          </div>
        </Card>
      )}
    />
  );
}
