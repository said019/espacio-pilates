import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely parse a date string. Handles ISO dates, date+time combos,
 * bare TIME strings, and returns fallback date if parsing fails.
 */
export function safeParse(value: string | null | undefined): Date {
  if (!value) return new Date(0);
  try {
    // Already a full ISO datetime
    if (value.includes("T") || value.includes("-")) return parseISO(value);
    // Bare time like "09:00:00" — combine with today
    if (/^\d{2}:\d{2}/.test(value)) {
      const today = new Date().toISOString().split("T")[0];
      return parseISO(`${today}T${value}`);
    }
    return new Date(value);
  } catch {
    return new Date(0);
  }
}
