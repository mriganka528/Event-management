import { cn } from "@/lib/utils";

type Option = {
  label: string;
  value: string;
};

export function Select({
  className,
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: readonly Option[] }) {
  return (
    <select
      className={cn(
        "flex h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--input)] px-4 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_20%,transparent)]",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
