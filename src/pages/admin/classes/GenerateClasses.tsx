import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles } from "lucide-react";

const generateSchema = z.object({
  classTypeId: z.string().min(1),
  instructorId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  daysOfWeek: z.array(z.number()).min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  maxCapacity: z.coerce.number().min(1),
});

type GenerateFormData = z.infer<typeof generateSchema>;

const DAYS = [
  { label: "Lunes", value: 1 }, { label: "Martes", value: 2 },
  { label: "Miércoles", value: 3 }, { label: "Jueves", value: 4 },
  { label: "Viernes", value: 5 }, { label: "Sábado", value: 6 },
  { label: "Domingo", value: 0 },
];

const GenerateClasses = () => {
  const { toast } = useToast();
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const { data: typesData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ["class-types"],
    queryFn: async () => (await api.get("/class-types")).data,
  });

  const { data: instructorsData } = useQuery<{ data: { id: string; displayName: string }[] }>({
    queryKey: ["instructors"],
    queryFn: async () => (await api.get("/instructors")).data,
  });

  const form = useForm<GenerateFormData>({
    resolver: zodResolver(generateSchema),
    defaultValues: { daysOfWeek: [], maxCapacity: 5, startTime: "09:00", endTime: "10:00" },
  });

  const generateMutation = useMutation({
    mutationFn: (d: GenerateFormData) => api.post("/classes/generate", d),
    onSuccess: (res: any) => toast({ title: `${res.data?.created ?? "N"} clases generadas` }),
    onError: (error: any) =>
      toast({
        title: error?.response?.data?.message ?? "Error generando clases",
        variant: "destructive",
      }),
  });

  const toggleDay = (v: number) => {
    const updated = selectedDays.includes(v) ? selectedDays.filter((d) => d !== v) : [...selectedDays, v];
    setSelectedDays(updated);
    form.setValue("daysOfWeek", updated);
  };

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-2xl">
          <div className="mb-7">
            <h1 className="text-3xl font-bold text-[#1A1A1A] mb-1">Generar Clases</h1>
            <p className="text-sm text-[#1A1A1A]/35">Crea clases en bloque para un rango de fechas</p>
          </div>

          <form onSubmit={form.handleSubmit((d) => generateMutation.mutate(d))} className="space-y-6">
            {/* Selects */}
            <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5 space-y-4">
              <p className="text-[11px] text-[#D9B5BA]/70 font-semibold uppercase tracking-wider">Clase e instructor</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-[#1A1A1A]/60 text-xs">Tipo de clase</Label>
                  <Select onValueChange={(v) => form.setValue("classTypeId", v)}>
                    <SelectTrigger className="bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A]">
                      <SelectValue placeholder="Seleccionar tipo" />
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
                      <SelectValue placeholder="Seleccionar instructor" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#F0D0D5] border-[#8C6B6F]/15">
                      {(Array.isArray(instructorsData?.data) ? instructorsData.data : []).map((i) => (
                        <SelectItem key={i.id} value={i.id} className="text-[#1A1A1A]">{i.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Date range */}
            <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5 space-y-4">
              <p className="text-[11px] text-[#8C6B6F]/70 font-semibold uppercase tracking-wider">Rango de fechas</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-[#1A1A1A]/60 text-xs">Fecha inicio</Label>
                  <DatePicker
                    value={form.watch("startDate")}
                    onChange={(v) => form.setValue("startDate", v)}
                    placeholder="Fecha inicio"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[#1A1A1A]/60 text-xs">Fecha fin</Label>
                  <DatePicker
                    value={form.watch("endDate")}
                    onChange={(v) => form.setValue("endDate", v)}
                    placeholder="Fecha fin"
                    min={form.watch("startDate")}
                  />
                </div>
              </div>
            </div>

            {/* Time range */}
            <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5 space-y-4">
              <p className="text-[11px] text-[#FDF7F8]/70 font-semibold uppercase tracking-wider">Horario</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div className="space-y-1 max-w-[150px]">
                <Label className="text-[#1A1A1A]/60 text-xs">Capacidad máxima</Label>
                <Input
                  type="number"
                  className="bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A]"
                  {...form.register("maxCapacity")}
                />
              </div>
            </div>

            {/* Days of week */}
            <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5 space-y-3">
              <p className="text-[11px] text-[#D9B5BA]/70 font-semibold uppercase tracking-wider">Días de la semana</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      selectedDays.includes(d.value)
                        ? "bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] text-white shadow-[0_0_10px_rgba(148,134,122,0.3)]"
                        : "bg-[#8C6B6F]/[0.06] border border-[#8C6B6F]/15 text-[#1A1A1A]/45 hover:text-[#1A1A1A]/75 hover:border-[#8C6B6F]/25"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={generateMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {generateMutation.isPending
                ? <Loader2 className="animate-spin" size={16} />
                : <Sparkles size={16} />}
              {generateMutation.isPending ? "Generando…" : "Generar clases"}
            </button>
          </form>
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default GenerateClasses;
