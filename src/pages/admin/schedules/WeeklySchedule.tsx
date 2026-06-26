import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TimePicker } from "@/components/ui/time-picker";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Plus } from "lucide-react";

const scheduleSchema = z.object({
  dayOfWeek: z.coerce.number().min(0).max(6),
  classTypeId: z.string().min(1),
  instructorId: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  maxCapacity: z.coerce.number().min(1),
  isActive: z.boolean().default(true),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;
interface Schedule extends ScheduleFormData { id: string; classTypeName?: string; instructorName?: string }

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const WeeklySchedule = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [mobileDay, setMobileDay] = useState(new Date().getDay());

  const { data } = useQuery<{ data: Schedule[] }>({
    queryKey: ["schedules"],
    queryFn: async () => (await api.get("/schedules")).data,
  });
  const schedules = Array.isArray(data?.data) ? data.data : [];

  const { data: typesData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ["class-types"],
    queryFn: async () => (await api.get("/class-types")).data,
  });

  const { data: instructorsData } = useQuery<{ data: { id: string; displayName: string }[] }>({
    queryKey: ["instructors"],
    queryFn: async () => (await api.get("/instructors")).data,
  });

  const form = useForm<ScheduleFormData>({ resolver: zodResolver(scheduleSchema), defaultValues: { maxCapacity: 5, isActive: true } });

  const createMutation = useMutation({
    mutationFn: (d: ScheduleFormData) => api.post("/schedules", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedules"] }); toast({ title: "Horario creado" }); setOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: Schedule) => api.put(`/schedules/${id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedules"] }); toast({ title: "Horario actualizado" }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedules"] }); toast({ title: "Horario eliminado" }); },
  });

  const openEdit = (s: Schedule) => { form.reset(s); setEditing(s); setOpen(true); };
  const openCreate = (dayOfWeek = mobileDay) => {
    form.reset({ dayOfWeek, maxCapacity: 5, isActive: true });
    setEditing(null);
    setOpen(true);
  };

  const grouped = DAYS.reduce((acc, _, i) => {
    acc[i] = schedules.filter((s) => s.dayOfWeek === i);
    return acc;
  }, {} as Record<number, Schedule[]>);

  const scheduleCard = (s: Schedule) => (
    <div key={s.id} className="mb-2 p-2.5 bg-[#8C6B6F]/[0.05] rounded-xl border border-[#8C6B6F]/12 text-xs">
      <div className="font-semibold text-[#1A1A1A]/80 text-[11px] truncate">{s.classTypeName ?? s.classTypeId}</div>
      <div className="text-[#1A1A1A]/50 text-[10px] mt-0.5">{s.startTime}–{s.endTime}</div>
      <div className="text-[#1A1A1A]/35 text-[10px] truncate">{s.instructorName ?? s.instructorId}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${s.isActive ? "text-[#4ade80] border-[#4ade80]/30 bg-[#4ade80]/5" : "text-[#1A1A1A]/25 border-[#8C6B6F]/15"}`}>
          {s.isActive ? "Activo" : "Inactivo"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 min-h-[44px] min-w-[44px] text-[#1A1A1A]/20 hover:text-[#1A1A1A]/60">
              <MoreHorizontal size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-[#F0D0D5] border-[#8C6B6F]/15">
            <DropdownMenuItem className="text-[#1A1A1A]/70 hover:text-[#1A1A1A]" onClick={() => openEdit(s)}>Editar</DropdownMenuItem>
            <DropdownMenuItem className="text-[#f87171]" onClick={() => { if (window.confirm("¿Eliminar este horario?")) deleteMutation.mutate(s.id); }}>Eliminar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-5xl">
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="admin-title font-bold text-[#1A1A1A]">Horarios semanales</h1>
              <p className="text-sm text-[#1A1A1A]/35">Plantilla semanal para crear clases más rápido.</p>
            </div>
            <button
              onClick={() => openCreate(isMobile ? mobileDay : new Date().getDay())}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] px-4 py-2 text-sm font-semibold text-[#1A1A1A] transition-opacity hover:opacity-90"
            >
              <Plus size={14} /> Nuevo horario
            </button>
          </div>

          {isMobile ? (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-2">
                <div className="flex min-w-max gap-2">
                  {DAYS.map((day, i) => {
                    const active = mobileDay === i;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setMobileDay(i)}
                        className={cn(
                          "flex min-h-[52px] min-w-[84px] flex-col items-center justify-center rounded-xl border px-2 text-xs transition-colors",
                          active
                            ? "border-[#8C6B6F]/60 bg-gradient-to-r from-[#8C6B6F]/20 to-[#D9B5BA]/20 text-[#1A1A1A]"
                            : "border-[#8C6B6F]/15 bg-[#8C6B6F]/10 text-[#1A1A1A]/70",
                        )}
                      >
                        <span className="text-[10px] uppercase">{day.slice(0, 3)}</span>
                        <span className="text-base font-bold leading-none">{grouped[i].length}</span>
                        <span className="mt-0.5 text-[10px] text-[#1A1A1A]/55">clases</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-[#1A1A1A]/45">{DAYS[mobileDay].slice(0, 3)}</p>
                    <p className="text-sm font-semibold text-[#1A1A1A]">{DAYS[mobileDay]}</p>
                  </div>
                  <Button size="sm" className="h-9" onClick={() => openCreate(mobileDay)}>
                    <Plus size={14} className="mr-1" /> Nueva
                  </Button>
                </div>

                {grouped[mobileDay].length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#8C6B6F]/15 p-6 text-center text-xs text-[#1A1A1A]/45">
                    Sin horarios para este día.
                  </div>
                ) : (
                  grouped[mobileDay].map((s) => scheduleCard(s))
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-7 gap-3">
              {DAYS.map((day, i) => (
                <div key={i} className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-3">
                  <p className="text-[10px] font-bold text-center mb-3 text-[#8C6B6F]/60 uppercase tracking-widest">
                    {day.slice(0, 3)}
                  </p>
                  {grouped[i].length === 0 ? (
                    <p className="text-center text-[#1A1A1A]/15 text-xs py-3">—</p>
                  ) : grouped[i].map((s) => scheduleCard(s))}
                </div>
              ))}
            </div>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md bg-[#F0D0D5] border-[#8C6B6F]/15 text-[#1A1A1A]">
            <DialogHeader>
              <DialogTitle className="text-[#1A1A1A]">{editing ? "Editar horario" : "Nuevo horario"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={form.handleSubmit((d) =>
                editing ? updateMutation.mutate({ ...d, id: editing.id }) : createMutation.mutate(d)
              )}
              className="space-y-4"
            >
              <div className="space-y-1">
                <Label className="text-[#1A1A1A]/60 text-xs">Día</Label>
                <Select
                  value={String(form.watch("dayOfWeek"))}
                  onValueChange={(v) => form.setValue("dayOfWeek", Number(v))}
                >
                  <SelectTrigger className="bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A]">
                    <SelectValue placeholder="Seleccionar día" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#F0D0D5] border-[#8C6B6F]/15">
                    {DAYS.map((d, i) => (
                      <SelectItem key={i} value={String(i)} className="text-[#1A1A1A]">{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[#1A1A1A]/60 text-xs">Tipo de clase</Label>
                <Select onValueChange={(v) => form.setValue("classTypeId", v)}>
                  <SelectTrigger className="bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A]">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#F0D0D5] border-[#8C6B6F]/15">
                    {(Array.isArray(typesData?.data) ? typesData.data : []).map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-[#1A1A1A]">{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[#1A1A1A]/60 text-xs">Instructor</Label>
                <Select onValueChange={(v) => form.setValue("instructorId", v)}>
                  <SelectTrigger className="bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A]">
                    <SelectValue placeholder="Instructor" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#F0D0D5] border-[#8C6B6F]/15">
                    {(Array.isArray(instructorsData?.data) ? instructorsData.data : []).map((i) => (
                      <SelectItem key={i.id} value={i.id} className="text-[#1A1A1A]">{i.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[#1A1A1A]/60 text-xs">Hora inicio</Label>
                  <TimePicker
                    value={form.watch("startTime")}
                    onChange={(v) => form.setValue("startTime", v)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[#1A1A1A]/60 text-xs">Hora fin</Label>
                  <TimePicker
                    value={form.watch("endTime")}
                    onChange={(v) => form.setValue("endTime", v)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[#1A1A1A]/60 text-xs">Capacidad máx.</Label>
                <Input
                  type="number"
                  className="bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A]"
                  {...form.register("maxCapacity")}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
                <Label className="text-[#1A1A1A]/60 text-xs">Activo</Label>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#8C6B6F]/15 text-[#1A1A1A]/60 hover:bg-[#8C6B6F]/[0.06]"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] text-white border-0"
                >
                  {editing ? "Actualizar" : "Crear"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </AuthGuard>
  );
};

export default WeeklySchedule;
