import { cn } from "@/lib/utils";

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-medium text-[var(--muted-strong)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

