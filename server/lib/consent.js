import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const consentText = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'consent.txt'), 'utf8').trim();
export const consentVersion = crypto.createHash('sha256').update(consentText).digest('hex');

export function validSignature(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 100) return false;
  let points = 0, length = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) return false;
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i];
      if (!Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) return false;
      if (++points > 10000) return false;
      if (i) length += Math.hypot(p[0] - stroke[i-1][0], p[1] - stroke[i-1][1]);
    }
  }
  return length > 0.1;
}

export function consentGuard(pool, getUserId) {
  return async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const result = userId ? await pool.query(
        'SELECT id FROM signed_consents WHERE user_id=$1 AND version=$2 LIMIT 1', [userId, consentVersion]
      ) : { rows: [] };
      if (!result.rows.length) return res.status(403).json({ code: 'CONSENT_REQUIRED', message: 'Actualización de consentimiento: la clienta debe ingresar a su cuenta, aceptar y firmar antes de reservar (también walk-in).', consentUrl: '/app/consent' });
      return next();
    } catch (err) {
      console.error('Consent verification failed:', err.message);
      return res.status(503).json({ message: 'No se pudo verificar el consentimiento. Intenta nuevamente.' });
    }
  };
}

export function registerConsentRoutes(app, pool, authMiddleware, adminMiddleware, notifyAdmins) {
  app.get('/api/consent', authMiddleware, async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM signed_consents WHERE user_id=$1 AND version=$2', [req.userId, consentVersion]);
      return res.json({ data: { text: consentText, version: consentVersion, signed: r.rows[0] || null } });
    } catch { return res.status(503).json({ message: 'No se pudo cargar el consentimiento.' }); }
  });
  app.post('/api/consent', authMiddleware, async (req, res) => {
    const { accepted, version, signerName, signerRole, signature } = req.body || {};
    if (version !== consentVersion) return res.status(409).json({ message: 'El documento cambió. Recarga y léelo antes de firmar.' });
    if (accepted !== true || typeof signerName !== 'string' || signerName.trim().length < 3 || signerName.length > 200
      || !['adult', 'guardian'].includes(signerRole) || !validSignature(signature)) {
      return res.status(400).json({ message: 'Escribe el nombre de quien firma, acepta el consentimiento y dibuja tu firma.' });
    }
    try {
      // Immutable, one signature per user/document version. Retries preserve the first evidence.
      const inserted = await pool.query(`INSERT INTO signed_consents (user_id,version,document_text,signer_name,signer_role,signature)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,version) DO NOTHING RETURNING id`,
      [req.userId, consentVersion, consentText, signerName.trim(), signerRole, JSON.stringify(signature)]);
      if (inserted.rows.length && notifyAdmins) {
        // Notify only for a newly persisted signature. Delivery failure must not
        // make the client think their already-saved signature was rejected.
        Promise.resolve().then(async () => {
          const client = await pool.query('SELECT display_name FROM users WHERE id=$1', [req.userId]);
          await notifyAdmins({ title: 'Consentimiento firmado', body: `${client.rows[0]?.display_name || 'Una clienta'} acaba de firmar su consentimiento.`,
            url: `/admin/clients/${req.userId}`, tag: `consent_signed_${inserted.rows[0].id}` });
        }).catch(err => console.error('Consent notification failed:', err.message));
      }
      return res.status(201).json({ message: 'Consentimiento firmado y guardado.' });
    } catch { return res.status(503).json({ message: 'No se pudo guardar la firma. Intenta nuevamente.' }); }
  });
  app.get('/api/admin/clients/:id/consents', adminMiddleware, async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM signed_consents WHERE user_id=$1 ORDER BY signed_at DESC', [req.params.id]);
      return res.json({ data: r.rows, currentVersion: consentVersion });
    } catch { return res.status(503).json({ message: 'No se pudieron consultar los consentimientos.' }); }
  });
}
