"use client";

import Image from "next/image";
import { Carousel } from "@/components/marketing/carousel";

export type GallerySlide = {
  id: string;
  src: string;
  name: string;
};

/**
 * The gallery carousel.
 *
 * A client component for the same reason as `PackageCarousel`: the render
 * function belongs on this side of the server/client boundary, where it can be a
 * prop, rather than in a server page where it cannot be passed at all.
 */
export function GalleryCarousel({ images }: { images: GallerySlide[] }) {
  return (
    <Carousel
      items={images}
      renderItem={(item) => (
        <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-3 shadow-sm">
          <Image src={item.src} alt={`${item.name} event setup`} width={1200} height={900} sizes="(min-width: 768px) 80vw, 100vw" className="h-[28rem] w-full rounded-[24px] object-cover" />
        </div>
      )}
    />
  );
}
