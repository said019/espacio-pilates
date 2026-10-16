import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  classId: string; branchId: string;
  instructors: { id: string; displayName: string }[];
  types: { id: string; name: string }[];
  onSaved: () => void;
};
export function ClassEditor(props: Props) {
  const [open, setOpen] = useState(false);
  return open ? <EditForm {...props} onClose={() => setOpen(false)} /> : <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>Editar clase</Button>;
}
function EditForm({ classId, branchId, instructors, types, onSaved, onClose }: Props & { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const query = useQuery({ queryKey: ['class-edit', classId, branchId], staleTime: 0,
    queryFn: async () => (await api.get(`/admin/classes/${classId}/edit`, { params: { branchId } })).data.data });
  useEffect(() => {
    if (query.data && !query.isFetching && !form) {
      const c = query.data;
      setForm({ date: c.date, startTime: c.start_time.slice(0, 5), endTime: c.end_time.slice(0, 5), maxCapacity: c.max_capacity,
        instructorId: c.instructor_id, classTypeId: c.class_type_id, revision: c.revision });
    }
  }, [query.data, query.isFetching, form]);
  const save = useMutation({
    mutationFn: () => api.put(`/admin/classes/${classId}/edit`, { ...form, branchId }),
    onSuccess: async () => {
      await Promise.all(['classes', 'admin-classes', 'coach-schedule', 'reports-instructors', 'class-edit', 'roster', 'class-roster-mini', 'my-bookings'].map(key => qc.invalidateQueries({ queryKey: [key] })));
      onSaved(); onClose();
    },
  });
  const field = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));
  return <form className="space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <h3 className="font-semibold">Editar esta clase</h3>
    <p className="text-xs text-muted-foreground">Se conservan las reservas, lista de espera y créditos. No cambia otras fechas ni la sucursal. Si cambias fecha, horario o tipo, avisa a las alumnas: esta edición no envía avisos automáticos.</p>
    {query.isError && <p role="alert" className="text-destructive">No se pudo cargar la clase. Cierra y vuelve a abrir el editor.</p>}
    {!form && !query.isError && <p>Cargando clase…</p>}
    {form && <fieldset disabled={save.isPending} className="space-y-3">
      <label className="block">Coach<select required className="mt-1 w-full rounded-md border bg-background p-2" value={form.instructorId} onChange={e => field('instructorId', e.target.value)}>
        <option value="" disabled>Selecciona coach</option>{instructors.map(i => <option key={i.id} value={i.id}>{i.displayName}</option>)}
      </select></label>
      <label className="block">Tipo de clase<select required className="mt-1 w-full rounded-md border bg-background p-2" value={form.classTypeId} onChange={e => field('classTypeId', e.target.value)}>
        <option value="" disabled>Selecciona tipo</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <label className="block">Fecha<Input required type="date" value={form.date} onChange={e => field('date', e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label>Inicio<Input required type="time" value={form.startTime} onChange={e => field('startTime', e.target.value)} /></label>
        <label>Fin<Input required type="time" value={form.endTime} onChange={e => field('endTime', e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">Horario de Ciudad de México.</p>
      <label className="block">Cupo<Input required type="number" min={1} max={1000} step={1} value={form.maxCapacity} onChange={e => field('maxCapacity', Number(e.target.value))} /></label>
      {save.isError && <p role="alert" className="text-destructive">{(save.error as any)?.response?.data?.message ?? 'No se pudo guardar la clase.'}</p>}
      <Button type="submit" className="w-full">{save.isPending ? 'Guardando…' : 'Guardar cambios'}</Button>
    </fieldset>}
    <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>Cancelar edición</Button>
  </form>;
}
