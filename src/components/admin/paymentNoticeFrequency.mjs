export function noticeWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}:${Number(parts.hour) < 12 ? 'morning' : Number(parts.hour) < 19 ? 'afternoon' : 'night'}`;
}
export function validNoticeDay(notice, now = new Date()) {
  if (!notice || typeof notice.texto !== 'string' || !notice.texto.trim() || notice.texto.length > 300 || !/^\d{4}-\d{2}-\d{2}$/.test(notice.fecha)) return false;
  const due = new Date(notice.fecha + 'T00:00:00Z');
  if (!Number.isFinite(due.getTime()) || due.toISOString().slice(0,10) !== notice.fecha) return false;
  due.setUTCDate(due.getUTCDate()-1);
  const today = noticeWindow(now).slice(0,10);
  return today === notice.fecha || today === due.toISOString().slice(0,10);
}
// One quota per origin and Mexico City period; never depends on message or due date.
export async function claimNoticeWindow({ now = new Date(), canShow = () => true, host = globalThis } = {}) {
  if (!host.window || !canShow()) return null;
  const slot = noticeWindow(now), key = `wallet-club:payment-notice:v2:${slot}`;
  const claim = () => {
    try {
      if (!canShow() || noticeWindow() !== slot && host === globalThis) return null;
      const storage = host.localStorage;
      if (!storage || storage.getItem(key)) return null;
      storage.setItem(key, 'shown');
      return storage.getItem(key) === 'shown' ? slot : null;
    } catch { return null; }
  };
  try { return host.navigator?.locks ? await host.navigator.locks.request('wallet-club-payment-notice', claim) : claim(); } catch { return null; }
}
