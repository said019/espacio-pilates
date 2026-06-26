/**
 * Styled date picker for the Valiance Pilates palette.
 * Works on both light admin pages and light client pages.
 * Accepts and emits "YYYY-MM-DD" strings.
 */
import { useState, useEffect, useRef } from "react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameDay, isSameMonth, isToday, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value?: string;           // "YYYY-MM-DD"
  onChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: string;             // "YYYY-MM-DD"
}

const DAYS_SHORT = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const safeParseISO = (s?: string): Date | null => {
  if (!s) return null;
  try { return parseISO(s); } catch { return null; }
};

export const DatePicker = ({
  value, onChange, placeholder = "Seleccionar fecha",
  className, disabled, min,
}: DatePickerProps) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(safeParseISO(value) ?? new Date());
  const ref = useRef<HTMLDivElement>(null);

  const selected = safeParseISO(value);
  const minDate  = safeParseISO(min);

  useEffect(() => {
    if (value) setViewMonth(safeParseISO(value) ?? new Date());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (d: Date) => {
    onChange?.(format(d, "yyyy-MM-dd"));
    setOpen(false);
  };

  const monthStart = startOfMonth(viewMonth);
  const monthEnd   = endOfMonth(viewMonth);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,   { weekStartsOn: 1 });

  const days: Date[] = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  if (isMobile) {
    return (
      <div className={cn("relative w-full", className)}>
        <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8C6B6F]" />
        <input
          type="date"
          min={min}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
          className={cn(
            "w-full rounded-xl border border-[#8C6B6F]/20 bg-white py-2.5 pl-9 pr-3 text-sm text-[#1A1A1A]",
            "focus:border-[#8C6B6F]/50 focus:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          aria-label={placeholder}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative inline-block w-full", className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border border-[#8C6B6F]/20 bg-white px-3 py-2.5 text-sm transition-all",
          "hover:border-[#8C6B6F]/40 focus:outline-none",
          open ? "border-[#8C6B6F]/50 ring-1 ring-[#8C6B6F]/20" : "",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        <CalendarDays size={14} className="shrink-0 text-[#8C6B6F]" />
        <span className={cn("flex-1 text-left", selected ? "text-[#1A1A1A] font-medium" : "text-[#8C6B6F]/50")}>
          {selected
            ? format(selected, "d 'de' MMMM yyyy", { locale: es })
            : placeholder}
        </span>
        <ChevronRight
          size={13}
          className={cn("text-[#8C6B6F]/40 transition-transform", open && "rotate-90")}
        />
      </button>

      {/* Dropdown calendar */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 rounded-2xl border border-[#8C6B6F]/15 bg-white shadow-xl shadow-black/10 p-4 min-w-[280px]">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8C6B6F]/50 hover:text-[#8C6B6F] hover:bg-[#8C6B6F]/10 transition-all"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="text-sm font-semibold text-[#1A1A1A] capitalize">
              {format(viewMonth, "MMMM yyyy", { locale: es })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8C6B6F]/50 hover:text-[#8C6B6F] hover:bg-[#8C6B6F]/10 transition-all"
            >
              <ChevronRight size={13} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_SHORT.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-[#8C6B6F]/60 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map((d) => {
              const isSelected   = selected && isSameDay(d, selected);
              const isThisMonth  = isSameMonth(d, viewMonth);
              const isCurrentDay = isToday(d);
              const isDisabled   = minDate ? d < minDate : false;

              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && select(d)}
                  className={cn(
                    "h-8 w-full rounded-lg text-xs font-medium transition-all",
                    isSelected
                      ? "bg-[#8C6B6F] text-white shadow-sm"
                      : isCurrentDay && !isSelected
                        ? "border border-[#D9B5BA] text-[#1A1A1A] bg-[#D9B5BA]/10"
                        : isThisMonth
                          ? "text-[#1A1A1A] hover:bg-[#8C6B6F]/10"
                          : "text-[#8C6B6F]/30",
                    isDisabled && "opacity-25 cursor-not-allowed"
                  )}
                >
                  {format(d, "d")}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-3 pt-2 border-t border-[#8C6B6F]/10 flex justify-center">
            <button
              type="button"
              onClick={() => select(new Date())}
              className="text-[11px] text-[#8C6B6F] hover:text-[#1A1A1A] transition-colors font-medium"
            >
              Hoy
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
