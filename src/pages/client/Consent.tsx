import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import ClientLayout from '@/components/layout/ClientLayout';
import ConsentRecord, { Signature } from '@/components/ConsentRecord';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';

export default function Consent() {
  const user = useAuthStore(s => s.user);
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState(user?.displayName ?? '');
  const [role, setRole] = useState('');
  const [strokes, setStrokes] = useState<number[][][]>([]);
  const drawing = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['consent', user?.id], queryFn: async () => (await api.get('/consent')).data.data, enabled: !!user });
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)), Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))];
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/consent', { accepted, version: query.data.version, signerName: name, signerRole: role, signature: strokes.filter(s => s.length > 1) });
      await qc.invalidateQueries({ queryKey: ['consent'] });
      const target = params.get('returnTo');
      navigate(target?.startsWith('/') && !target.startsWith('//') && !target.includes('\\') && !target.startsWith('/app/consent') ? target : '/app/classes');
    } catch (err: any) { setError(err.response?.data?.message || 'No se pudo guardar. Intenta nuevamente.'); }
    finally { setSaving(false); }
  };
  return <ClientLayout><div className="max-w-3xl mx-auto p-4 space-y-5">
    <h1 className="text-2xl font-semibold">Consentimiento informado</h1>
    <p>Es obligatorio aceptarlo y firmarlo antes de reservar, también para clases walk-in. Aplica en Villa Magna y Pozos.</p>
    {!user ? <Link to="/auth/login?returnUrl=/app/consent">Inicia sesión para firmar</Link> : query.isLoading ? <p>Cargando documento…</p> : query.isError ? <div role="alert">No se pudo cargar. <button onClick={() => query.refetch()}>Reintentar</button></div> : query.data?.signed ? <><ConsentRecord record={query.data.signed} /><Link to="/app/classes">Continuar a clases</Link></> : query.data && <>
      <div className="max-h-[50vh] overflow-y-auto border rounded-xl p-4 whitespace-pre-wrap text-sm" tabIndex={0}>{query.data.text}</div>
      <label className="block">Nombre completo de quien firma<input className="block w-full border rounded p-3 mt-1" maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={saving} autoComplete="name" /></label>
      <label className="block">Quien firma<select className="block w-full border rounded p-3 mt-1" value={role} onChange={e => setRole(e.target.value)} disabled={saving}><option value="">Selecciona una opción</option><option value="adult">Soy la participante y soy mayor de edad</option><option value="guardian">Soy madre, padre o tutor legal de la participante menor de edad</option></select></label>
      <label className="flex items-start gap-3"><input type="checkbox" checked={accepted} disabled={saving} onChange={e => setAccepted(e.target.checked)} className="mt-1" /><span>He leído y comprendido el documento y lo acepto voluntariamente.</span></label>
      <p id="signature-help">Dibuja tu firma con el dedo o el mouse dentro del recuadro.</p>
      <div className="border-2 rounded-xl bg-white text-black touch-none" aria-describedby="signature-help"
        onPointerDown={e => { if (saving || !e.isPrimary) return; e.preventDefault(); drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const p=point(e); setStrokes(s => [...s, [p]]); }}
        onPointerMove={e => { if (!drawing.current || saving) return; const p=point(e); setStrokes(s => s.map((stroke,i) => i === s.length-1 ? [...stroke,p] : stroke)); }}
        onPointerUp={() => { drawing.current=false; }} onPointerCancel={() => { drawing.current=false; }}>
        <Signature strokes={strokes} />
      </div>
      <Button variant="outline" disabled={saving} onClick={() => setStrokes([])}>Borrar firma</Button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button className="w-full" onClick={save} disabled={saving || !accepted || !name.trim() || !role || !strokes.some(s => s.length>1)}>{saving ? 'Guardando…' : 'Aceptar y guardar firma'}</Button>
    </>}
  </div></ClientLayout>;
}
