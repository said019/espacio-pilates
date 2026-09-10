import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import ConsentRecord from '@/components/ConsentRecord';
export default function ClientConsent({ userId }: { userId: string }) {
  const query = useQuery({ queryKey: ['client-consents', userId], queryFn: async () => (await api.get(`/admin/clients/${userId}/consents`)).data });
  const records = query.data?.data ?? [];
  return <section className="rounded-xl border p-4 my-5 space-y-3">
    <h2 className="text-lg font-semibold">Consentimiento / responsiva</h2>
    {query.isLoading ? <p>Cargando…</p> : query.isError ? <p role="alert">No se pudo consultar el consentimiento.</p> : <>
      <p>{records.some((r: any) => r.version === query.data.currentVersion) ? 'Consentimiento vigente firmado' : 'Firma pendiente. La clienta debe entrar a su cuenta y firmar antes de reservar.'}</p>
      {records.map((record: any) => <ConsentRecord key={record.id} record={record} />)}
    </>}
  </section>;
}
