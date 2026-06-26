import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";

export const COUNTRIES = [
  { code: "MX", dial: "52", name: "México", flag: "🇲🇽" },
  { code: "US", dial: "1", name: "Estados Unidos", flag: "🇺🇸" },
  { code: "CA", dial: "1", name: "Canadá", flag: "🇨🇦" },
  { code: "ES", dial: "34", name: "España", flag: "🇪🇸" },
  { code: "CO", dial: "57", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", dial: "54", name: "Argentina", flag: "🇦🇷" },
  { code: "CL", dial: "56", name: "Chile", flag: "🇨🇱" },
  { code: "PE", dial: "51", name: "Perú", flag: "🇵🇪" },
  { code: "BR", dial: "55", name: "Brasil", flag: "🇧🇷" },
  { code: "GT", dial: "502", name: "Guatemala", flag: "🇬🇹" },
  { code: "SV", dial: "503", name: "El Salvador", flag: "🇸🇻" },
  { code: "HN", dial: "504", name: "Honduras", flag: "🇭🇳" },
  { code: "CR", dial: "506", name: "Costa Rica", flag: "🇨🇷" },
  { code: "PA", dial: "507", name: "Panamá", flag: "🇵🇦" },
  { code: "VE", dial: "58", name: "Venezuela", flag: "🇻🇪" },
  { code: "EC", dial: "593", name: "Ecuador", flag: "🇪🇨" },
  { code: "UY", dial: "598", name: "Uruguay", flag: "🇺🇾" },
  { code: "DO", dial: "1", name: "República Dominicana", flag: "🇩🇴" },
  { code: "GB", dial: "44", name: "Reino Unido", flag: "🇬🇧" },
  { code: "FR", dial: "33", name: "Francia", flag: "🇫🇷" },
  { code: "DE", dial: "49", name: "Alemania", flag: "🇩🇪" },
  { code: "IT", dial: "39", name: "Italia", flag: "🇮🇹" },
] as const;

const SORTED_DIALS = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length);

function splitPhone(full: string): { dial: string; national: string } {
  const digits = String(full || "").replace(/\D/g, "");
  if (!digits) return { dial: "52", national: "" };
  for (const dial of SORTED_DIALS) {
    if (digits.startsWith(dial)) return { dial, national: digits.slice(dial.length) };
  }
  return { dial: "52", national: digits };
}

interface PhoneInputProps {
  value: string;
  onChange: (full: string) => void;
  placeholder?: string;
  defaultDial?: string;
  className?: string;
  id?: string;
}

export function PhoneInput({ value, onChange, placeholder = "10 dígitos", defaultDial = "52", className, id }: PhoneInputProps) {
  const [dial, setDial] = useState<string>(() => (value ? splitPhone(value).dial : defaultDial));
  const [national, setNational] = useState<string>(() => splitPhone(value).national);

  useEffect(() => {
    if (!value) { setNational(""); return; }
    const s = splitPhone(value);
    setDial(s.dial);
    setNational(s.national);
  }, [value]);

  const emit = (d: string, n: string) => {
    const clean = n.replace(/\D/g, "");
    onChange(clean ? `+${d}${clean}` : "");
  };

  const options = useMemo(() =>
    COUNTRIES.map((c) => ({ ...c, key: `${c.code}-${c.dial}` })),
  []);

  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <Select
        value={`${dial}`}
        onValueChange={(v) => { setDial(v); emit(v, national); }}
      >
        <SelectTrigger className="w-[110px] shrink-0">
          <SelectValue>
            <span className="text-sm">+{dial}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((c) => (
            <SelectItem key={c.key} value={c.dial}>
              <span className="mr-2">{c.flag}</span>
              <span className="text-xs text-muted-foreground">+{c.dial}</span>
              <span className="ml-2 text-sm">{c.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        placeholder={placeholder}
        value={national}
        onChange={(e) => { const n = e.target.value.replace(/\D/g, ""); setNational(n); emit(dial, n); }}
        className="flex-1"
      />
    </div>
  );
}
