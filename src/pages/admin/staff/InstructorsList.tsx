import { useState, useRef } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus, Upload, Camera } from "lucide-react";

const instructorSchema = z.object({
  displayName: z.string().min(1, "Nombre requerido"),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().email("Email inválido").optional(),
  ),
  phone: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.string().optional(),
  isActive: z.boolean().default(true),
  photoFocusX: z.coerce.number().min(0).max(100).default(50),
  photoFocusY: z.coerce.number().min(0).max(100).default(50),
  sortOrder: z.coerce.number().int().default(0),
});

type InstructorFormData = z.infer<typeof instructorSchema>;
interface Instructor extends Omit<InstructorFormData, "specialties"> {
  id: string;
  specialties?: string[] | string | null;
  photoUrl?: string;
  photoFocusX?: number;
  photoFocusY?: number;
  sortOrder?: number;
  phone?: string;
}

function clampFocus(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeSpecialties(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch (_) {}
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function getFocusFromPointerEvent(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clampFocus(((event.clientX - rect.left) / rect.width) * 100),
    y: clampFocus(((event.clientY - rect.top) / rect.height) * 100),
  };
}

const InstructorsList = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);

  // File refs — one for table-row quick upload, one inside dialog
  const quickFileRef = useRef<HTMLInputElement>(null);
  const dialogFileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: Instructor[] }>({
    queryKey: ["instructors"],
    queryFn: async () => (await api.get("/instructors")).data,
  });
  const instructors = Array.isArray(data?.data) ? data.data : [];

  const form = useForm<InstructorFormData>({
    resolver: zodResolver(instructorSchema),
    defaultValues: { isActive: true, photoFocusX: 50, photoFocusY: 50, sortOrder: 0 },
  });

  const createMutation = useMutation({
    mutationFn: (d: InstructorFormData) => api.post("/instructors", {
      ...d,
      specialties: d.specialties?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
      photoFocusX: clampFocus(d.photoFocusX),
      photoFocusY: clampFocus(d.photoFocusY),
      sortOrder: d.sortOrder ?? 0,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["instructors"] }); toast({ title: "Coach creado" }); setOpen(false); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al crear", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string } & InstructorFormData) => {
      const { id, specialties, ...rest } = payload;
      return api.put(`/instructors/${id}`, {
        ...rest,
        specialties: specialties ? specialties.split(",").map((s) => s.trim()).filter(Boolean) : [],
        photoFocusX: clampFocus(rest.photoFocusX),
        photoFocusY: clampFocus(rest.photoFocusY),
        sortOrder: rest.sortOrder ?? 0,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["instructors"] }); toast({ title: "✅ Coach actualizada" }); setOpen(false); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/instructors/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["instructors"] }); toast({ title: "Coach eliminada" }); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al eliminar", variant: "destructive" }),
  });

  const magicLinkMutation = useMutation({
    mutationFn: (id: string) => api.post(`/instructors/${id}/magic-link`),
    onSuccess: (res: any) => {
      if (res.data?.data?.link) {
        navigator.clipboard.writeText(res.data.data.link);
        toast({ title: "✅ Magic link copiado" });
      }
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al generar link", variant: "destructive" }),
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("photo", file);
      return api.post(`/instructors/${id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["instructors"] });
      toast({ title: "✅ Foto actualizada" });
      // Update the editing state so preview refreshes without closing dialog
      if (editing && res?.data?.data) {
        setEditing((prev) => prev ? { ...prev, photoUrl: res.data.data.photoUrl ?? prev.photoUrl } : prev);
      }
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al subir foto", variant: "destructive" }),
  });

  const openEdit = (i: Instructor) => {
    form.reset({
      displayName: i.displayName,
      email: i.email ?? "",
      phone: i.phone ?? "",
      bio: i.bio ?? "",
      specialties: normalizeSpecialties(i.specialties).join(", "),
      isActive: i.isActive,
      photoFocusX: clampFocus(i.photoFocusX),
      photoFocusY: clampFocus(i.photoFocusY),
      sortOrder: i.sortOrder ?? 0,
    });
    setEditing(i);
    setOpen(true);
  };

  const openCreate = () => {
    form.reset({ isActive: true, photoFocusX: 50, photoFocusY: 50, sortOrder: instructors.length });
    setEditing(null);
    setOpen(true);
  };

  const focusX = clampFocus(form.watch("photoFocusX"));
  const focusY = clampFocus(form.watch("photoFocusY"));

  const applyPreviewFocus = (event: React.PointerEvent<HTMLElement>) => {
    const next = getFocusFromPointerEvent(event);
    form.setValue("photoFocusX", next.x, { shouldDirty: true, shouldTouch: true });
    form.setValue("photoFocusY", next.y, { shouldDirty: true, shouldTouch: true });
  };

  const handleSubmit = (d: InstructorFormData) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...d });
    } else {
      createMutation.mutate(d);
    }
  };

  const currentPhoto = editing?.photoUrl;

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-5xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Coaches / Equipo</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Las coaches aparecen en la sección "Equipo" del sitio, ordenadas por el campo Orden.
              </p>
            </div>
            <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Nueva coach</Button>
          </div>

          {/* Hidden file input for quick upload from dropdown */}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={quickFileRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && uploadTargetId) uploadPhotoMutation.mutate({ id: uploadTargetId, file: f });
              e.target.value = "";
              setUploadTargetId(null);
            }}
          />

          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Orden</TableHead>
                  <TableHead className="w-14">Foto</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden sm:table-cell">Especialidades</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array(4).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(7).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                    </TableRow>
                  ))
                  : instructors.map((ins) => (
                    <TableRow key={ins.id}>
                      <TableCell className="text-center text-sm text-muted-foreground font-mono">
                        {ins.sortOrder ?? 0}
                      </TableCell>
                      <TableCell>
                        {ins.photoUrl
                          ? <img src={ins.photoUrl} className="w-9 h-9 rounded-full object-cover" style={{ objectPosition: `${clampFocus(ins.photoFocusX)}% ${clampFocus(ins.photoFocusY)}%` }} alt="" />
                          : <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">{ins.displayName?.[0]}</div>
                        }
                      </TableCell>
                      <TableCell className="font-medium">{ins.displayName}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{ins.email}</TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{normalizeSpecialties(ins.specialties).join(", ")}</TableCell>
                      <TableCell><Badge variant={ins.isActive ? "default" : "secondary"}>{ins.isActive ? "Activa" : "Inactiva"}</Badge></TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => openEdit(ins)}>Editar</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setUploadTargetId(ins.id); setTimeout(() => quickFileRef.current?.click(), 0); }}>
                              <Upload size={13} className="mr-2" />Subir foto
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => magicLinkMutation.mutate(ins.id)}>Magic link</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("¿Eliminar esta coach?")) deleteMutation.mutate(ins.id); }}>Eliminar</DropdownMenuItem>
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
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar coach" : "Nueva coach"}</DialogTitle>
            </DialogHeader>

            {/* Hidden file input for dialog photo upload */}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={dialogFileRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && editing) uploadPhotoMutation.mutate({ id: editing.id, file: f });
                e.target.value = "";
              }}
            />

            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              {/* Photo preview & upload — only while editing */}
              {editing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Foto</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => dialogFileRef.current?.click()}
                      disabled={uploadPhotoMutation.isPending}
                    >
                      <Camera size={13} className="mr-1.5" />
                      {uploadPhotoMutation.isPending ? "Subiendo…" : currentPhoto ? "Cambiar foto" : "Subir foto"}
                    </Button>
                  </div>

                  {currentPhoto ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">
                        Haz clic o arrastra sobre la imagen para ajustar el punto de enfoque (cara).
                      </p>
                      <button
                        type="button"
                        onPointerDown={applyPreviewFocus}
                        onPointerMove={(e) => {
                          if (e.buttons !== 1 && e.pointerType !== "touch") return;
                          applyPreviewFocus(e);
                        }}
                        className="group relative mx-auto block h-[320px] w-full max-w-[260px] touch-none overflow-hidden rounded-[24px] border border-border bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Ajustar enfoque de la foto"
                      >
                        <img
                          src={currentPhoto}
                          alt={editing.displayName}
                          className="absolute inset-0 h-full w-full object-cover"
                          style={{ objectPosition: `${focusX}% ${focusY}%` }}
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                        <div
                          className="pointer-events-none absolute h-8 w-8 rounded-full border border-white/40 bg-white/20 shadow backdrop-blur-sm"
                          style={{ left: `${focusX}%`, top: `${focusY}%`, transform: "translate(-50%, -50%)" }}
                        >
                          <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                        </div>
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-3 py-2 text-[10px] font-medium text-white/80">
                          <span>X {focusX}%</span><span>Y {focusY}%</span>
                        </div>
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
                      <p className="text-xs text-muted-foreground">Sin foto — sube una para verla aquí</p>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>Nombre *</Label>
                  <Input {...form.register("displayName")} placeholder="Ej. Maca" />
                  {form.formState.errors.displayName && (
                    <p className="text-xs text-destructive">{form.formState.errors.displayName.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" {...form.register("email")} placeholder="coach@valiance.com" />
                  {form.formState.errors.email && (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Teléfono</Label>
                  <Input {...form.register("phone")} placeholder="+52 55 0000 0000" />
                </div>

                <div className="col-span-2 space-y-1">
                  <Label>Bio</Label>
                  <Input {...form.register("bio")} placeholder="Una frase corta sobre ella" />
                </div>

                <div className="col-span-2 space-y-1">
                  <Label>Especialidades <span className="text-muted-foreground text-[11px]">(separadas por coma)</span></Label>
                  <Input {...form.register("specialties")} placeholder="Pilates Reformer, Barre, Mat" />
                </div>

                <div className="space-y-1">
                  <Label>
                    Orden en el sitio
                    <span className="ml-1 text-[11px] text-muted-foreground">(menor = primero)</span>
                  </Label>
                  <Input type="number" min={0} step={1} {...form.register("sortOrder")} />
                </div>

                <div className="flex items-center gap-3 pt-5">
                  <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
                  <Label>Activa</Label>
                </div>
              </div>

              {/* Focus sliders — only when no photo preview available */}
              {!currentPhoto && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Enfoque horizontal</Label>
                      <span className="text-xs text-muted-foreground">{focusX}%</span>
                    </div>
                    <Input type="range" min={0} max={100} step={1} value={focusX}
                      onChange={(e) => form.setValue("photoFocusX", Number(e.target.value), { shouldDirty: true })} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Enfoque vertical</Label>
                      <span className="text-xs text-muted-foreground">{focusY}%</span>
                    </div>
                    <Input type="range" min={0} max={100} step={1} value={focusY}
                      onChange={(e) => form.setValue("photoFocusY", Number(e.target.value), { shouldDirty: true })} />
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {(createMutation.isPending || updateMutation.isPending) && <span className="mr-2 animate-spin">⏳</span>}
                  {editing ? "Guardar cambios" : "Crear coach"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </AuthGuard>
  );
};

export default InstructorsList;
