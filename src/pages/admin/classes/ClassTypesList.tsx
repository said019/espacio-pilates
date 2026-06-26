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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus } from "lucide-react";

const PALETTE_COLORS = [
  { label: "Sage", value: "#D9B5BA" },
  { label: "Taupe", value: "#8C6B6F" },
  { label: "Crema", value: "#FDF7F8" },
  { label: "Azul", value: "#3B82F6" },
  { label: "Esmeralda", value: "#10B981" },
  { label: "Naranja", value: "#F97316" },
  { label: "Rosa", value: "#EC4899" },
  { label: "Índigo", value: "#6366F1" },
];

const typeSchema = z.object({
  name: z.string().min(1),
  color: z.string().default("#D9B5BA"),
  defaultDuration: z.coerce.number().min(1),
  maxCapacity: z.coerce.number().min(1),
  isActive: z.boolean().default(true),
});

type TypeFormData = z.infer<typeof typeSchema>;
interface ClassType extends TypeFormData { id: string; durationMin?: number; capacity?: number }

const ClassTypesList = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClassType | null>(null);

  const { data, isLoading } = useQuery<{ data: ClassType[] }>({
    queryKey: ["class-types"],
    queryFn: async () => (await api.get("/class-types")).data,
  });
  const types = Array.isArray(data?.data) ? data.data : [];

  const form = useForm<TypeFormData>({ resolver: zodResolver(typeSchema), defaultValues: { color: "#D9B5BA", defaultDuration: 60, maxCapacity: 5, isActive: true } });

  const createMutation = useMutation({
    mutationFn: (d: TypeFormData) => api.post("/class-types", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["class-types"] }); toast({ title: "Tipo creado" }); setOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: ClassType) => api.put(`/class-types/${id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["class-types"] }); toast({ title: "Tipo actualizado" }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/class-types/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["class-types"] }); toast({ title: "Tipo eliminado" }); },
  });

  const openEdit = (t: ClassType) => {
    form.reset({
      name: t.name,
      color: t.color,
      defaultDuration: t.defaultDuration ?? t.durationMin ?? 60,
      maxCapacity: t.maxCapacity ?? t.capacity ?? 10,
      isActive: t.isActive,
    });
    setEditing(t);
    setOpen(true);
  };
  const openCreate = () => { form.reset({ color: "#D9B5BA", defaultDuration: 60, maxCapacity: 5, isActive: true }); setEditing(null); setOpen(true); };

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-4xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <h1 className="text-2xl font-bold">Tipos de Clase</h1>
            <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Nuevo tipo</Button>
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Color</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead>Capacidad</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell><div className="w-5 h-5 rounded-full" style={{ backgroundColor: t.color }} /></TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.defaultDuration ?? t.durationMin ?? "—"} min</TableCell>
                    <TableCell>{t.maxCapacity ?? t.capacity ?? "—"}</TableCell>
                    <TableCell><Badge variant={t.isActive ? "default" : "secondary"}>{t.isActive ? "Activo" : "Inactivo"}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => openEdit(t)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("¿Eliminar este tipo de clase?")) deleteMutation.mutate(t.id); }}>Eliminar</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editing ? "Editar tipo" : "Nuevo tipo de clase"}</DialogTitle></DialogHeader>
            <form onSubmit={form.handleSubmit((d) => editing ? updateMutation.mutate({ ...d, id: editing.id }) : createMutation.mutate(d))} className="space-y-4">
              <div className="space-y-1"><Label>Nombre</Label><Input {...form.register("name")} /></div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {PALETTE_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => form.setValue("color", c.value)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${form.watch("color") === c.value ? "border-foreground scale-110" : "border-transparent opacity-70 hover:opacity-100"}`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
                <Input type="color" {...form.register("color")} className="h-8 w-16 cursor-pointer" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Duración (min)</Label><Input type="number" {...form.register("defaultDuration")} /></div>
                <div className="space-y-1"><Label>Capacidad máx.</Label><Input type="number" {...form.register("maxCapacity")} /></div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
                <Label>Activo</Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit">{editing ? "Actualizar" : "Crear"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </AuthGuard>
  );
};

export default ClassTypesList;
