import { Link } from 'react-router-dom';

export function RosterName({ userId, name }: { userId?: string | null; name: string }) {
  return userId ? <Link to={`/admin/clients/${encodeURIComponent(userId)}`} className="text-sm font-medium break-words underline decoration-border underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2">{name}</Link>
    : <span className="text-sm font-medium break-words">{name}</span>;
}

export function CancellationHistory({ rows }: { rows: any[] }) {
  return <details className="rounded-xl border p-3">
    <summary className="cursor-pointer text-sm font-medium">Canceladas ({rows.length})</summary>
    <p className="my-2 text-xs text-muted-foreground">Hora de Ciudad de México. No ocupan lugar.</p>
    {!rows.length && <p className="text-sm text-muted-foreground">Sin cancelaciones registradas.</p>}
    <ul className="space-y-2">
      {rows.map(row => {
        const at = row.cancelledAt ?? row.cancelled_at;
        const date = at ? new Date(at) : null;
        const by = row.cancelledBy ?? row.cancelled_by;
        const actor = ({ user: 'Alumna', admin: 'Administración', system: 'Sistema' } as Record<string, string>)[by] ?? 'No registrado';
        return <li key={row.bookingId ?? row.booking_id} className="rounded-lg bg-muted/40 p-2">
          <RosterName userId={row.userId ?? row.user_id} name={row.displayName ?? row.display_name ?? 'Invitada'} />
          <p className="text-xs mt-1">Canceló: {actor}</p>
          <p className="text-xs text-muted-foreground">{date && Number.isFinite(date.getTime()) ? date.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Fecha y hora no registradas'}</p>
        </li>;
      })}
    </ul>
  </details>;
}
