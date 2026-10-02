"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CarouselItem = { id: string };

export function Carousel<T extends CarouselItem>({
  items,
  renderItem,
  className,
  autoPlay = true,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  autoPlay?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!autoPlay || items.length <= 1) return;
    const interval = window.setInterval(() => setActiveIndex((current) => (current + 1) % items.length), 4500);
    return () => window.clearInterval(interval);
  }, [autoPlay, items.length]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="overflow-hidden">
        <div className="flex transition-transform duration-500" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {items.map((item, index) => (
            <div key={item.id} className="w-full shrink-0">
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn("h-2.5 w-8 rounded-full bg-stone-200 transition", activeIndex === index && "bg-amber-500")}
              aria-label={`Go to slide ${index + 1}`}
              aria-pressed={activeIndex === index}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Previous slide" onClick={() => setActiveIndex((current) => (current - 1 + items.length) % items.length)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Next slide" onClick={() => setActiveIndex((current) => (current + 1) % items.length)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
