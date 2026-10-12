import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function BookingCutoffEditor({ classId, branchId }: { classId: string; branchId?: string }) {
  const [minutes, setMinutes] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const queryKey = ["class-booking-cutoff", classId, branchId];
  const endpoint = `/admin/classes/${classId}/booking-cutoff`;
  const query = useQuery({ queryKey, enabled: Boolean(branchId), queryFn: async () => (await api.get(endpoint, { params: { branchId } })).data });
  useEffect(() => { setMinutes(query.data ? String(query.data.minutes) : ""); }, [query.data, classId]);
  const save = useMutation({
    mutationFn: () => api.put(endpoint, { branchId, minutes: Number(minutes) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["booking-eligibility", classId] });
      toast({ title: "Cierre de reservas actualizado" });
    },
    onError: () => toast({ title: "No se pudo guardar el cierre de reservas", variant: "destructive" }),
  });
  return <div className="space-y-2 rounded-xl border p-3">
    <Label htmlFor={`cutoff-${classId}`}>Cerrar reservas antes de la clase (minutos)</Label>
    <div className="flex gap-2">
      <Input id={`cutoff-${classId}`} type="number" min={0} max={10080} step={1} value={minutes} onChange={e => setMinutes(e.target.value)} disabled={!query.isSuccess || save.isPending} />
      <Button onClick={() => save.mutate()} disabled={!query.isSuccess || save.isPending || minutes === "" || !Number.isInteger(Number(minutes)) || Number(minutes) < 0 || Number(minutes) > 10080}>{save.isPending ? "Guardando…" : "Guardar"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">60 = una hora antes. 0 = sin cierre anticipado. Aplica solo a esta clase; no cambia otras fechas, reservas existentes ni la asignación manual de la admin.</p>
    {query.isError && <Button variant="link" onClick={() => query.refetch()}>No se pudo cargar. Reintentar</Button>}
  </div>;
}
