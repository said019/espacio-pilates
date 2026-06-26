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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus } from "lucide-react";

const CATEGORIES = [
  { value: "reformer",  label: "Pilates Reformer",      color: "bg-[#D9B5BA]/20 text-[#8C6B6F] border-[#D9B5BA]/30" },
  { value: "barre",     label: "Barre",                 color: "bg-[#8C6B6F]/15 text-[#8C6B6F] border-[#8C6B6F]/25" },
  { value: "mixto",     label: "Combo (Reformer + Barre)", color: "bg-[#8C6B6F]/10 text-[#1A1A1A]/70 border-[#8C6B6F]/20" },
  { value: "bienestar", label: "Bienestar",             color: "bg-[#8C6B6F]/20 text-[#8C6B6F] border-[#8C6B6F]/30" },
  { value: "pilates",   label: "Pilates (legacy)",      color: "bg-[#D9B5BA]/20 text-[#8C6B6F] border-[#D9B5BA]/30" },
  { value: "all",       label: "Todas (sin filtro)",    color: "bg-[#8C6B6F]/10 text-[#1A1A1A]/60 border-[#8C6B6F]/20" },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]["value"];

const planSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  description: z.string().optional(),
  price: z.coerce.number().min(0),
  currency: z.string().default("MXN"),
  durationDays: z.coerce.number().min(1),
  classLimit: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().nullable()),
  classCategory: z.enum(["reformer", "barre", "mixto", "pilates", "bienestar", "all"]).default("all"),
  features: z.string().optional(),
  isActive: z.boolean().default(true),
  isNonTransferable: z.boolean().default(false),
  isNonRepeatable: z.boolean().default(false),
  repeatKey: z.string().optional(),
  sortOrder: z.coerce.number().default(0),
  discountPrice: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().nullable().default(null)),
  scheduleDays: z.array(z.number()).default([]),
  scheduleStart: z.string().default(""),
  scheduleEnd: z.string().default(""),
  scheduleMessage: z.string().default(""),
});

type PlanFormData = z.infer<typeof planSchema>;

interface Plan extends PlanFormData {
  id: string;
}

function normalizePlanRow(row: any): Plan {
  return {
    id: String(row?.id ?? ""),
    name: String(row?.name ?? ""),
    description: String(row?.description ?? ""),
    price: Number(row?.price ?? 0),
    currency: String(row?.currency ?? "MXN"),
    durationDays: Number(row?.durationDays ?? row?.duration_days ?? 30),
    classLimit: (() => {
      const raw = row?.classLimit ?? row?.class_limit ?? row?.class_limit_override;
      if (raw === "" || raw === undefined || raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    })(),
    classCategory: ((row?.classCategory ?? row?.class_category ?? "all") as CategoryValue),
    features: Array.isArray(row?.features)
      ? row.features.join(", ")
      : String(row?.features ?? ""),
    isActive: Boolean(row?.isActive ?? row?.is_active ?? true),
    isNonTransferable: Boolean(row?.isNonTransferable ?? row?.is_non_transferable ?? false),
    isNonRepeatable: Boolean(row?.isNonRepeatable ?? row?.is_non_repeatable ?? false),
    repeatKey: String(row?.repeatKey ?? row?.repeat_key ?? ""),
    sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? 0),
    discountPrice: (() => {
      const raw = row?.discountPrice ?? row?.discount_price;
      if (raw === "" || raw === undefined || raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    })(),
    scheduleDays: (() => {
      const tr = row?.timeRestriction ?? row?.time_restriction;
      const days = tr?.days_of_week ?? tr?.daysOfWeek;
      return Array.isArray(days) ? days.map(Number).filter((n) => n >= 0 && n <= 6) : [];
    })(),
    scheduleStart: (() => {
      const tr = row?.timeRestriction ?? row?.time_restriction;
      const range = tr?.hour_range ?? tr?.hourRange;
      return Array.isArray(range) && range[0] ? String(range[0]) : "";
    })(),
    scheduleEnd: (() => {
      const tr = row?.timeRestriction ?? row?.time_restriction;
      const range = tr?.hour_range ?? tr?.hourRange;
      return Array.isArray(range) && range[1] ? String(range[1]) : "";
    })(),
    scheduleMessage: (() => {
      const tr = row?.timeRestriction ?? row?.time_restriction;
      return String(tr?.message ?? "");
    })(),
  };
}

const EMPTY: PlanFormData = {
  name: "", description: "", price: 0, currency: "MXN",
  durationDays: 30, classLimit: null, classCategory: "all",
  features: "", isActive: true, isNonTransferable: false, isNonRepeatable: false, repeatKey: "", sortOrder: 0,
  discountPrice: null,
  scheduleDays: [], scheduleStart: "", scheduleEnd: "", scheduleMessage: "",
};

const DAY_LABELS = [
  { value: 0, short: "D",  long: "Domingo" },
  { value: 1, short: "L",  long: "Lunes" },
  { value: 2, short: "M",  long: "Martes" },
  { value: 3, short: "Mi", long: "Miércoles" },
  { value: 4, short: "J",  long: "Jueves" },
  { value: 5, short: "V",  long: "Viernes" },
  { value: 6, short: "S",  long: "Sábado" },
];

function serializePlan(d: PlanFormData) {
  const hasSchedule = d.scheduleDays?.length > 0 || (d.scheduleStart && d.scheduleEnd);
  const time_restriction = hasSchedule
    ? {
        days_of_week: [...(d.scheduleDays ?? [])].sort((a, b) => a - b),
        hour_range: d.scheduleStart && d.scheduleEnd ? [d.scheduleStart, d.scheduleEnd] : [],
        message: d.scheduleMessage?.trim() || "",
      }
    : null;
  return {
    ...d,
    repeatKey: d.isNonRepeatable ? (d.repeatKey?.trim() || null) : null,
    discount_price: d.discountPrice,
    features: d.features
      ? d.features.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    time_restriction,
  };
}

function normalizePlan(p: Plan): PlanFormData {
  return {
    ...p,
    classCategory: ((p as any).classCategory ?? (p as any).class_category ?? "all") as CategoryValue,
    features: Array.isArray(p.features)
      ? (p.features as unknown as string[]).join(", ")
      : (p.features as unknown as string) ?? "",
    isNonTransferable: Boolean((p as any).isNonTransferable ?? (p as any).is_non_transferable),
    isNonRepeatable: Boolean((p as any).isNonRepeatable ?? (p as any).is_non_repeatable),
    repeatKey: String((p as any).repeatKey ?? (p as any).repeat_key ?? ""),
    discountPrice: (() => {
      const raw = (p as any).discountPrice ?? (p as any).discount_price;
      if (raw === "" || raw === undefined || raw === null) return null;
      return Number(raw);
    })(),
  };
}

const PlansList = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);

  const { data, isLoading } = useQuery<{ data: Plan[] }>({
    queryKey: ["plans"],
    queryFn: async () => (await api.get("/plans")).data,
  });
  const plans = Array.isArray(data?.data) ? data.data.map(normalizePlanRow) : [];

  const form = useForm<PlanFormData>({ resolver: zodResolver(planSchema), defaultValues: EMPTY });

  const createMutation = useMutation({
    mutationFn: (d: PlanFormData) => api.post("/plans", serializePlan(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plans"] }); toast({ title: "Plan creado" }); closeDialog(); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al crear", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: Plan) => api.put(`/plans/${id}`, serializePlan(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plans"] }); toast({ title: "Plan actualizado" }); closeDialog(); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, cascade, hard }: { id: string; cascade?: boolean; hard?: boolean }) => {
      const params = new URLSearchParams();
      if (cascade) params.set("cascade", "true");
      if (hard) params.set("hard", "true");
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.delete(`/plans/${id}${qs}`);
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      const msg = res?.data?.message ?? "Plan eliminado";
      toast({ title: msg });
    },
    onError: (e: any) => {
      const payload = e?.response?.data;
      const title = payload?.message ?? "Error al eliminar";
      const description = payload?.detail;
      toast({ title, description, variant: "destructive" });
    },
  });

  const openCreate = () => { form.reset(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (p: Plan) => { form.reset(normalizePlan(p)); setEditing(p); setOpen(true); };
  const closeDialog = () => { setOpen(false); setEditing(null); };

  const onSubmit = (d: PlanFormData) => {
    if (editing) updateMutation.mutate({ ...d, id: editing.id });
    else createMutation.mutate(d);
  };

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-5xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <h1 className="text-2xl font-bold">Planes</h1>
            <Button onClick={openCreate} size="sm"><Plus size={14} className="mr-1" />Nuevo plan</Button>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead>Límite clases</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="min-w-[260px]">Condiciones</TableHead>
                  <TableHead>Reglas</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody className={isLoading ? undefined : "stagger-in"}>
                {isLoading
                  ? Array(4).fill(0).map((_, i) => (
                    <TableRow key={i}>{Array(9).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                  : plans.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <span>${p.price} {p.currency}</span>
                        {p.discountPrice != null && p.discountPrice > 0 && (
                          <p className="text-[10px] text-[#6B4F53] font-semibold">Efvo/transf: ${p.discountPrice}</p>
                        )}
                      </TableCell>
                      <TableCell>{p.durationDays} días</TableCell>
                      <TableCell>{p.classLimit == null ? "Ilimitado" : p.classLimit === 0 ? "0" : p.classLimit}</TableCell>
                      <TableCell>
                        {(() => {
                          const cat = CATEGORIES.find((c) => c.value === (p.classCategory ?? "all")) ?? CATEGORIES[2];
                          return <Badge className={`border ${cat.color}`}>{cat.label}</Badge>;
                        })()}
                      </TableCell>
                      <TableCell className="align-top">
                        {(() => {
                          const raw = (p as any).features;
                          const list: string[] = Array.isArray(raw)
                            ? raw
                            : (typeof raw === "string" && raw.trim()
                              ? raw.split(",").map((s) => s.trim()).filter(Boolean)
                              : []);
                          if (!list.length) return <span className="text-xs text-muted-foreground">—</span>;
                          return (
                            <ul className="text-xs leading-relaxed space-y-0.5">
                              {list.map((item, i) => (
                                <li key={i} className="text-[#3D3A3A]">• {item}</li>
                              ))}
                            </ul>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {Boolean((p as any).isNonTransferable ?? (p as any).is_non_transferable) && (
                            <Badge variant="outline">No transferible</Badge>
                          )}
                          {Boolean((p as any).isNonRepeatable ?? (p as any).is_non_repeatable) && (
                            <Badge variant="outline">No repetible</Badge>
                          )}
                          {!Boolean((p as any).isNonTransferable ?? (p as any).is_non_transferable) &&
                            !Boolean((p as any).isNonRepeatable ?? (p as any).is_non_repeatable) && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.isActive ? "default" : "secondary"}>
                          {p.isActive ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => openEdit(p)}>Editar</DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => updateMutation.mutate({ ...p, isActive: !p.isActive })}
                            >
                              {p.isActive ? "Desactivar" : "Activar"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                const isLegacySession = p.name === "Sesión Extra (Socias o Inscritas)";
                                const msg = isLegacySession
                                  ? "¿Eliminar esta sesión y todos sus datos relacionados?"
                                  : "¿Desactivar este plan? (se oculta pero conserva historial)";
                                if (window.confirm(msg)) {
                                  deleteMutation.mutate({ id: p.id, cascade: isLegacySession });
                                }
                              }}
                            >
                              {p.isActive ? "Desactivar (soft)" : "Eliminar"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "¿Eliminar PERMANENTEMENTE este plan?\n\nSolo funciona si no tiene ninguna clienta asociada (incluidas canceladas). Si hay suscripciones, usa 'Desactivar'."
                                  )
                                ) {
                                  deleteMutation.mutate({ id: p.id, hard: true });
                                }
                              }}
                            >
                              Eliminar permanentemente
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar plan" : "Nuevo plan"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input {...form.register("name")} />
                {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Categoría de clases</Label>
                <Select
                  value={form.watch("classCategory") ?? "all"}
                  onValueChange={(v) => form.setValue("classCategory", v as CategoryValue)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Descripción</Label>
                <Input {...form.register("description")} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Precio (MXN)</Label>
                  <Input type="number" {...form.register("price")} />
                </div>
                <div className="space-y-1">
                  <Label>Precio efectivo/transf.</Label>
                  <Input type="number" placeholder="Vacío = sin descuento" {...form.register("discountPrice")} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Duración (días)</Label>
                <Input type="number" {...form.register("durationDays")} />
              </div>
              <div className="space-y-1">
                <Label>Límite de clases (vacío = ilimitado)</Label>
                <Input type="number" placeholder="null = ilimitado" {...form.register("classLimit")} />
              </div>
              <div className="space-y-1">
                <Label>Beneficios (separados por coma)</Label>
                <Input {...form.register("features")} />
              </div>

              {/* ── Horario permitido (opcional) ───────────────────────── */}
              <div className="space-y-3 rounded-xl border border-[#FAE5E7] bg-[#FBF0F2]/40 p-3">
                <div>
                  <Label className="text-sm">Restricción de horario (opcional)</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Si llenas esto, el sistema bloquea reservas fuera del horario.
                    Déjalo vacío si el plan no tiene restricción.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Días permitidos</Label>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {DAY_LABELS.map((d) => {
                      const days = form.watch("scheduleDays") ?? [];
                      const active = days.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => {
                            const next = active
                              ? days.filter((x) => x !== d.value)
                              : [...days, d.value];
                            form.setValue("scheduleDays", next, { shouldDirty: true });
                          }}
                          className={`w-9 h-9 rounded-full text-xs font-semibold transition-colors ${
                            active
                              ? "bg-[#1A1A1A] text-white"
                              : "bg-white border border-[#FAE5E7] text-[#8C6B6F] hover:bg-[#FAE5E7]/30"
                          }`}
                          title={d.long}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Hora inicio</Label>
                    <Input type="time" {...form.register("scheduleStart")} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Hora fin</Label>
                    <Input type="time" {...form.register("scheduleEnd")} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mensaje al bloquear (opcional)</Label>
                  <Input
                    placeholder="ej: Tu Morning Pass solo aplica de lunes a viernes en clases de 7-9 AM"
                    {...form.register("scheduleMessage")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <Switch
                    checked={form.watch("isNonTransferable")}
                    onCheckedChange={(v) => form.setValue("isNonTransferable", v)}
                  />
                  <Label>No transferible</Label>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <Switch
                    checked={form.watch("isNonRepeatable")}
                    onCheckedChange={(v) => form.setValue("isNonRepeatable", v)}
                  />
                  <Label>No repetible</Label>
                </div>
              </div>
              {form.watch("isNonRepeatable") && (
                <div className="space-y-1">
                  <Label>Clave de repetición (grupo)</Label>
                  <Input placeholder="ej. trial_single_session" {...form.register("repeatKey")} />
                </div>
              )}
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.watch("isActive")}
                  onCheckedChange={(v) => form.setValue("isActive", v)}
                />
                <Label>Activo</Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
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

export default PlansList;
