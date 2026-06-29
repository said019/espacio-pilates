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
import { MoreHorizontal, Plus, Trash2, Pencil } from "lucide-react";

const CHANNELS = [
  { value: "all",        label: "Todos (app, recepción y eventos)" },
  { value: "membership", label: "Solo en la app (membresías)" },
  { value: "pos",        label: "Solo en recepción (POS)" },
  { value: "event",      label: "Solo eventos" },
] as const;

const schema = z.object({
  code: z.string().min(1, "Código requerido"),
  discountType: z.enum(["percent", "fixed"]).default("percent"),
  discountValue: z.coerce.number().positive("Debe ser mayor a 0"),
  maxUses: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive().nullable().default(null),
  ),
  expiresAt: z.string().optional().default(""),
  minOrderAmount: z.coerce.number().min(0).default(0),
  planId: z.string().optional().default(""),
  channel: z.enum(["all", "membership", "pos", "event"]).default("all"),
  isActive: z.boolean().default(true),
});

type FormData = z.infer<typeof schema>;

const EMPTY: FormData = {
  code: "", discountType: "percent", discountValue: 10, maxUses: null,
  expiresAt: "", minOrderAmount: 0, planId: "", channel: "all", isActive: true,
};

interface DiscountRow {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  minOrderAmount: number;
  planId: string | null;
  planName: string | null;
  channel: string;
  isActive: boolean;
}

function normalizeRow(r: any): DiscountRow {
  return {
    id: String(r?.id ?? ""),
    code: String(r?.code ?? ""),
    discountType: (r?.discountType ?? r?.discount_type ?? "percent") as "percent" | "fixed",
    discountValue: Number(r?.discountValue ?? r?.discount_value ?? 0),
    maxUses: (() => {
      const v = r?.maxUses ?? r?.max_uses;
      return v === null || v === undefined || v === "" ? null : Number(v);
    })(),
    usesCount: Number(r?.usesCount ?? r?.uses_count ?? 0),
    expiresAt: r?.expiresAt ?? r?.expires_at ?? null,
    minOrderAmount: Number(r?.minOrderAmount ?? r?.min_order_amount ?? 0),
    planId: r?.planId ?? r?.plan_id ?? null,
    planName: r?.planName ?? r?.plan_name ?? null,
    channel: String(r?.channel ?? "all"),
    isActive: Boolean(r?.isActive ?? r?.is_active ?? false),
  };
}

function rowToForm(r: DiscountRow): FormData {
  return {
    code: r.code,
    discountType: r.discountType,
    discountValue: r.discountValue,
    maxUses: r.maxUses,
    expiresAt: r.expiresAt ? String(r.expiresAt).slice(0, 10) : "",
    minOrderAmount: r.minOrderAmount,
    planId: r.planId ?? "",
    channel: (["all", "membership", "pos", "event"].includes(r.channel) ? r.channel : "all") as FormData["channel"],
    isActive: r.isActive,
  };
}

function serialize(d: FormData) {
  return {
    code: d.code.trim().toUpperCase(),
    discountType: d.discountType,
    discountValue: d.discountValue,
    maxUses: d.maxUses,
    expiresAt: d.expiresAt || null,
    minOrderAmount: d.minOrderAmount || 0,
    planId: d.planId || null,
    channel: d.channel,
    isActive: d.isActive,
  };
}

const DiscountCodesList = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["discount-codes"],
    queryFn: async () => (await api.get("/discount-codes")).data,
  });
  const codes: DiscountRow[] = Array.isArray(data?.data) ? data.data.map(normalizeRow) : [];

  const { data: plansData } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => (await api.get("/plans")).data,
  });
  const plans: { id: string; name: string }[] = Array.isArray(plansData?.data)
    ? plansData.data.map((p: any) => ({ id: String(p.id), name: String(p.name) }))
    : [];

  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const createMutation = useMutation({
    mutationFn: (d: FormData) => api.post("/discount-codes", serialize(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discount-codes"] }); toast({ title: "Código creado" }); closeDialog(); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al crear", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: FormData & { id: string }) => api.put(`/discount-codes/${id}`, serialize(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discount-codes"] }); toast({ title: "Código actualizado" }); closeDialog(); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/discount-codes/${id}`),
    onSuccess: (res: any) => { qc.invalidateQueries({ queryKey: ["discount-codes"] }); toast({ title: res?.data?.message ?? "Código eliminado" }); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al eliminar", variant: "destructive" }),
  });

  const openCreate = () => { form.reset(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (r: DiscountRow) => { form.reset(rowToForm(r)); setEditing(r); setOpen(true); };
  const closeDialog = () => { setOpen(false); setEditing(null); };

  const onSubmit = (d: FormData) => {
    if (editing) updateMutation.mutate({ ...d, id: editing.id });
    else createMutation.mutate(d);
  };

  const toggleActive = (r: DiscountRow) =>
    updateMutation.mutate({ ...rowToForm(r), isActive: !r.isActive, id: r.id });

  const dtype = form.watch("discountType");
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-5xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Códigos de descuento</h1>
              <p className="text-sm text-muted-foreground mt-1">
                El descuento se aplica al total; con tarjeta, el 4% de plataforma se calcula sobre el monto ya descontado.
              </p>
            </div>
            <Button onClick={openCreate} size="sm"><Plus size={14} className="mr-1" />Nuevo código</Button>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descuento</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Aplica a</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Activo</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [1, 2, 3].map((i) => (
                    <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                  ))
                ) : codes.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Aún no hay códigos. Crea el primero.</TableCell></TableRow>
                ) : (
                  codes.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono font-semibold">{r.code}</TableCell>
                      <TableCell>{r.discountType === "percent" ? `${r.discountValue}%` : `$${r.discountValue.toLocaleString("es-MX")}`}</TableCell>
                      <TableCell>{r.usesCount}{r.maxUses ? ` / ${r.maxUses}` : ""}</TableCell>
                      <TableCell className="text-sm">{r.planName ?? "Todos los planes"}</TableCell>
                      <TableCell className="text-sm">{r.expiresAt ? String(r.expiresAt).slice(0, 10) : "Sin límite"}</TableCell>
                      <TableCell>
                        <Switch checked={r.isActive} onCheckedChange={() => toggleActive(r)} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal size={16} /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}><Pencil size={14} className="mr-2" />Editar</DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => { if (window.confirm(`¿Eliminar el código ${r.code}?`)) deleteMutation.mutate(r.id); }}
                            >
                              <Trash2 size={14} className="mr-2" />Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : closeDialog())}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar código" : "Nuevo código"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label>Código</Label>
                  <Input
                    {...form.register("code")}
                    placeholder="BIENVENIDA10"
                    className="uppercase"
                    onChange={(e) => form.setValue("code", e.target.value.toUpperCase())}
                  />
                  {form.formState.errors.code && <p className="text-xs text-destructive mt-1">{form.formState.errors.code.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Tipo</Label>
                    <Select value={dtype} onValueChange={(v) => form.setValue("discountType", v as "percent" | "fixed")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Porcentaje (%)</SelectItem>
                        <SelectItem value="fixed">Monto fijo ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{dtype === "percent" ? "Porcentaje" : "Monto (MXN)"}</Label>
                    <Input type="number" step="0.01" {...form.register("discountValue")} />
                    {form.formState.errors.discountValue && <p className="text-xs text-destructive mt-1">{form.formState.errors.discountValue.message}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Usos máximos</Label>
                    <Input type="number" placeholder="Ilimitado" {...form.register("maxUses")} />
                  </div>
                  <div>
                    <Label>Vence</Label>
                    <Input type="date" {...form.register("expiresAt")} />
                  </div>
                </div>

                <div>
                  <Label>Compra mínima (MXN)</Label>
                  <Input type="number" step="0.01" {...form.register("minOrderAmount")} />
                </div>

                <div>
                  <Label>Plan</Label>
                  <Select value={form.watch("planId") || "all"} onValueChange={(v) => form.setValue("planId", v === "all" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los planes</SelectItem>
                      {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Dónde aplica</Label>
                  <Select value={form.watch("channel")} onValueChange={(v) => form.setValue("channel", v as FormData["channel"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label>Activo</Label>
                  <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
                  <Button type="submit" disabled={saving}>{saving ? "Guardando…" : editing ? "Guardar" : "Crear"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default DiscountCodesList;
