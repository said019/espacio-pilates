export function Signature({ strokes }: { strokes: number[][][] }) {
  return <svg viewBox="0 0 600 200" preserveAspectRatio="none" className="w-full h-40" aria-label="Firma manuscrita" role="img">
    {strokes.map((stroke, i) => <polyline key={i} points={stroke.map(([x,y]) => `${x*600},${y*200}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}
export default function ConsentRecord({ record }: { record: any }) {
  const download = () => {
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
    const paths = record.signature.map((stroke: number[][]) => `<polyline points="${stroke.map(([x,y]) => `${Number(x)*600},${Number(y)*200}`).join(' ')}" fill="none" stroke="black" stroke-width="2"/>`).join('');
    const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Consentimiento firmado</title><body><h1>Tu Espacio Pilates</h1><p>Firmante: ${escape(record.signer_name)}</p><p>${record.signer_role === 'guardian' ? 'Madre, padre o tutor legal' : 'Participante mayor de edad'}</p><p>Fecha: ${escape(new Date(record.signed_at).toLocaleString('es-MX'))}</p><p>Cuenta: ${escape(record.user_id)}</p><p>Versión: ${escape(record.version)}</p><pre style="white-space:pre-wrap;font-family:serif">${escape(record.document_text)}</pre><svg viewBox="0 0 600 200" width="600">${paths}</svg></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `consentimiento-${record.id}.html`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-3 rounded-xl border p-4">
    <p>Firmado por <strong>{record.signer_name}</strong> · {new Date(record.signed_at).toLocaleString('es-MX')}</p>
    <p>{record.signer_role === 'guardian' ? 'Madre, padre o tutor legal' : 'Participante mayor de edad'}</p>
    <Signature strokes={record.signature} />
    <details><summary className="cursor-pointer">Ver documento firmado</summary><p className="whitespace-pre-wrap text-sm mt-3">{record.document_text}</p></details>
    <button type="button" className="underline" onClick={download}>Descargar consentimiento firmado</button>
  </div>;
}
