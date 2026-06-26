import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CalendarDays } from "lucide-react";

type ScheduleSlot = {
  id: string;
  time_slot: string;
  day_of_week: number; // 1=Mon..7=Sun
  class_type_id: string | null;
  class_type_name: string | null;
  instructor_name: string | null;
  is_active: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  userName?: string;
};

const DAY_LABELS: Record<number, string> = {
  1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves",
  5: "Viernes", 6: "Sábado", 7: "Domingo",
};

const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function pad(n: number) { return String(n).padStart(2, "0"); }

function formatDbDate(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split("-");
  return `${d}/${m}/${y}`;
}

export function BulkMonthBookingDialog({ open, onOpenChange, userId, userName }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date();

  const [scheduleId, setScheduleId] = useState<string>("");
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: slotsRes, isLoading: loadingSlots } = useQuery({
    queryKey: ["admin-schedule-slots"],
    queryFn: async () => (await api.get("/admin/schedule-slots")).data,
    enabled: open,
  });
  const slots: ScheduleSlot[] = Array.isArray(slotsRes?.data) ? slotsRes.data : [];

  const selectedSlot = useMemo(
    () => slots.find(s => s.id === scheduleId) ?? null,
    [slots, scheduleId]
  );

  // Fechas candidatas: todos los días del mes cuyo day_of_week coincide con el slot
  const candidateDates = useMemo<string[]>(() => {
    if (!selectedSlot) return [];
    const daysInMonth = new Date(year, month, 0).getDate();
    const out: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const jsDow = date.getDay(); // Sun=0..Sat=6
      const slotDow = selectedSlot.day_of_week === 7 ? 0 : selectedSlot.day_of_week;
      if (jsDow === slotDow) {
        out.push(`${year}-${pad(month)}-${pad(d)}`);
      }
    }
    return out;
  }, [selectedSlot, month, year]);

  // Al cambiar slot/mes/año, preselecciona todas las fechas no pasadas
  useEffect(() => {
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    setSelected(new Set(candidateDates.filter(d => d >= todayStr)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateDates.join(",")]);

  // Reset al cerrar
  useEffect(() => {
    if (!open) {
      setScheduleId("");
      setMonth(today.getMonth() + 1);
      setYear(today.getFullYear());
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (date: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === candidateDates.length) setSelected(new Set());
    else setSelected(new Set(candidateDates));
  };

  const submit = useMutation({
    mutationFn: async () => {
      const res = await api.post("/admin/bookings/bulk-month", {
        userId,
        scheduleSlotId: scheduleId,
        selectedDates: Array.from(selected).sort(),
      });
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["client-bookings", userId] });
      qc.invalidateQueries({ queryKey: ["client-memberships", userId] });
      const d = data?.data ?? {};
      const skipped = d.skipped ?? {};
      const parts: string[] = [];
      if (d.booked) parts.push(`${d.booked} reservada(s)`);
      if (skipped.missingDates?.length) parts.push(`${skipped.missingDates.length} sin clase programada`);
      if (skipped.full?.length) parts.push(`${skipped.full.length} llena(s)`);
      if (skipped.duplicates?.length) parts.push(`${skipped.duplicates.length} ya reservada(s)`);
      toast({
        title: data?.message ?? "Reservas creadas",
        description: parts.join(" · ") || undefined,
      });
      onOpenChange(false);
    },
    onError: (e: any) => {
      const payload = e?.response?.data;
      const missing = payload?.missingDates?.length
        ? ` · Sin clase: ${payload.missingDates.map(formatDbDate).join(", ")}`
        : "";
      toast({
        title: payload?.message ?? "Error al reservar",
        description: missing || undefined,
        variant: "destructive",
      });
    },
  });

  const canSubmit = !!scheduleId && selected.size > 0 && !submit.isPending;

  // Opciones de año: actual y siguiente
  const yearOptions = [today.getFullYear(), today.getFullYear() + 1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays size={18} />
            Agendar mes completo
          </DialogTitle>
        </DialogHeader>

        {userName && (
          <p className="text-sm text-muted-foreground -mt-1">
            Cliente: <span className="font-medium text-foreground">{userName}</span>
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Horario recurrente</Label>
            <Select value={scheduleId} onValueChange={setScheduleId} disabled={loadingSlots}>
              <SelectTrigger>
                <SelectValue placeholder={loadingSlots ? "Cargando horarios…" : "Selecciona un horario"} />
              </SelectTrigger>
              <SelectContent>
                {slots.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {DAY_LABELS[s.day_of_week] ?? s.day_of_week} · {s.time_slot} · {s.class_type_name ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Mes</Label>
              <Select value={String(month)} onValueChange={v => setMonth(parseInt(v, 10))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((label, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Año</Label>
              <Select value={String(year)} onValueChange={v => setYear(parseInt(v, 10))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {scheduleId && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Fechas a reservar</Label>
                {candidateDates.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    {selected.size === candidateDates.length ? "Ninguna" : "Todas"}
                  </button>
                )}
              </div>

              {candidateDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay fechas con este día de la semana en {MONTH_LABELS[month - 1]} {year}.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {candidateDates.map(d => (
                    <label
                      key={d}
                      className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selected.has(d)}
                        onCheckedChange={() => toggle(d)}
                      />
                      <span className="text-sm">{formatDbDate(d)}</span>
                    </label>
                  ))}
                </div>
              )}

              {selected.size > 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                  Se descontarán <strong>{selected.size}</strong> crédito(s) de la mejor membresía compatible.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => submit.mutate()} disabled={!canSubmit}>
            {submit.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            Reservar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BulkMonthBookingDialog;
