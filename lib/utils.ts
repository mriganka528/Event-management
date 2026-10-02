import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string | { toString(): string }, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value.toString()));
  } catch {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value.toString()));
  }
}

export function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Short date without the time, for tight mobile layouts. */
export function formatDateShort(value: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

/** Compact money label (Rs 1.2L / Rs 45K) for chart axes and small cards. */
export function formatCurrencyCompact(value: number | string, currency = "INR") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const symbol = currency === "INR" ? "₹" : "";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}${symbol}${trimZero(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${trimZero(abs / 1_000)}K`;
  return `${sign}${symbol}${trimZero(abs)}`;
}

function trimZero(value: number) {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)+/g, "");
  return slug || "item";
}
