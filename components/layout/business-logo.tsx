import Image from "next/image";
import { TentTree } from "lucide-react";

/**
 * The business logo, as a tile.
 *
 * The uploaded artwork is arbitrary: a photograph, a mark on transparent
 * background, a wide banner. Rendering it straight into the bar therefore
 * looked like nothing at all when the artwork was light on a light surface —
 * which is most of them — and it looked broken when the artwork was wider
 * than it was tall.
 *
 * The tile gives it a defined edge whatever the artwork is, and the mark
 * behind it means a missing or transparent image still reads as a logo
 * rather than as an empty box.
 */
export function BusinessLogo({
  businessName,
  logoUrl,
  className = "",
}: {
  businessName: string;
  logoUrl?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-white ${className}`}
    >
      <TentTree className="absolute h-5 w-5 text-[var(--brand-dark)] opacity-40" aria-hidden="true" />
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={businessName}
          width={40}
          height={40}
          sizes="40px"
          className="relative h-full w-full object-contain p-0.5"
        />
      ) : null}
    </span>
  );
}
