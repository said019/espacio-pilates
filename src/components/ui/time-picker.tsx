/**
 * Styled time picker for the Valiance Pilates dark palette.
 * Renders a clean HH:MM selector with +/- controls.
 * Accepts and emits "HH:MM" strings (same as <input type="time">).
 */
import { useState, useEffect } from "react";
import { ChevronUp, ChevronDown, Clock } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  value?: string;           // "HH:MM"
  onChange?: (v: string) => void;
  className?: string;
  disabled?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

const parseTime = (v?: string): [number, number] => {
  if (!v) return [9, 0];
  const [h, m] = v.split(":").map(Number);
  return [isNaN(h) ? 9 : h, isNaN(m) ? 0 : m];
};

export const TimePicker = ({ value, onChange, className, disabled }: TimePickerProps) => {
  const isMobile = useIsMobile();
  const [hours, setHours] = useState(9);
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    const [h, m] = parseTime(value);
    setHours(h);
    setMinutes(m);
  }, [value]);

  const emit = (h: number, m: number) => {
    onChange?.(`${pad(h)}:${pad(m)}`);
  };

  const changeHours = (delta: number) => {
    const next = (hours + delta + 24) % 24;
    setHours(next);
    emit(next, minutes);
  };

  const changeMinutes = (delta: number) => {
    let nextM = minutes + delta;
    let nextH = hours;
    if (nextM >= 60) { nextM -= 60; nextH = (nextH + 1) % 24; }
    if (nextM < 0)   { nextM += 60; nextH = (nextH + 23) % 24; }
    setHours(nextH);
    setMinutes(nextM);
    emit(nextH, nextM);
  };

  const Spin = ({ up, onClick }: { up: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center text-[#8C6B6F]/40 hover:text-[#8C6B6F] transition-colors disabled:opacity-30"
    >
      {up ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  );

  if (isMobile) {
    return (
      <div
        className={cn(
          "inline-flex w-full items-center gap-2 rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.06] px-3 py-2",
          "focus-within:border-[#8C6B6F]/40 focus-within:bg-[#8C6B6F]/[0.08]",
          disabled && "opacity-50 pointer-events-none",
          className,
        )}
      >
        <Clock size={13} className="text-[#8C6B6F]/50 shrink-0" />
        <input
          type="time"
          step={300}
          value={value ?? `${pad(hours)}:${pad(minutes)}`}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full bg-transparent text-sm text-[#1A1A1A] focus:outline-none"
          aria-label="Seleccionar hora"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.06] px-3 py-2 select-none",
        "focus-within:border-[#8C6B6F]/40 focus-within:bg-[#8C6B6F]/[0.08]",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      <Clock size={13} className="text-[#8C6B6F]/50 shrink-0" />

      {/* Hours */}
      <div className="flex flex-col items-center gap-0.5">
        <Spin up onClick={() => changeHours(1)} />
        <span className="text-base font-bold text-[#1A1A1A] w-7 text-center tabular-nums leading-none">
          {pad(hours)}
        </span>
        <Spin up={false} onClick={() => changeHours(-1)} />
      </div>

      <span className="text-lg font-bold text-[#8C6B6F]/60 leading-none -mt-0.5">:</span>

      {/* Minutes */}
      <div className="flex flex-col items-center gap-0.5">
        <Spin up onClick={() => changeMinutes(5)} />
        <span className="text-base font-bold text-[#1A1A1A] w-7 text-center tabular-nums leading-none">
          {pad(minutes)}
        </span>
        <Spin up={false} onClick={() => changeMinutes(-5)} />
      </div>
    </div>
  );
};

export default TimePicker;
