const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateClassEdit(body) {
  const { date, startTime, endTime, maxCapacity, instructorId, classTypeId, revision } = body ?? {};
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return 'Fecha inválida.';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(startTime ?? '') || !time.test(endTime ?? '') || endTime <= startTime) return 'La hora final debe ser posterior al inicio, en el mismo día.';
  if (!Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 1000) return 'El cupo debe ser un entero entre 1 y 1000.';
  if (!uuid.test(instructorId ?? '') || !uuid.test(classTypeId ?? '')) return 'Selecciona una coach y un tipo de clase válidos.';
  if (typeof revision !== 'string' || !revision) return 'Recarga la clase antes de editar.';
  return null;
}

export function registerClassEditor(app, { pool, adminMiddleware, resolveRequestBranch }) {
  app.get('/api/admin/classes/:id/edit', adminMiddleware, async (req, res) => {
    try {
      const branch = await resolveRequestBranch(req);
      if (!branch || !uuid.test(req.params.id)) return res.status(400).json({ message: 'Selecciona una clase y sucursal válidas.' });
      const result = await pool.query(`SELECT id, date::text, start_time::text, end_time::text, instructor_id,
        class_type_id, max_capacity, updated_at::text AS revision FROM classes WHERE id=$1 AND branch_id=$2`, [req.params.id, branch.id]);
      if (!result.rows.length) return res.status(404).json({ message: 'Clase no encontrada.' });
      return res.json({ data: result.rows[0] });
    } catch (error) {
      console.error('Read class edit', error.message);
      return res.status(500).json({ message: 'No se pudo cargar la clase.' });
    }
  });
  app.put('/api/admin/classes/:id/edit', adminMiddleware, async (req, res) => {
    const error = validateClassEdit(req.body);
    if (error || !uuid.test(req.params.id)) return res.status(400).json({ message: error || 'Clase inválida.' });
    let client;
    try {
      const branch = await resolveRequestBranch(req);
      if (!branch) return res.status(400).json({ message: 'Selecciona una sucursal.' });
      client = await pool.connect();
      await client.query('BEGIN');
      const reject = async (status, message) => { await client.query('ROLLBACK'); return res.status(status).json({ message }); };
      const result = await client.query('SELECT *, updated_at::text AS revision FROM classes WHERE id=$1 AND branch_id=$2 FOR UPDATE', [req.params.id, branch.id]);
      const current = result.rows[0];
      if (!current) return await reject(404, 'Clase no encontrada en esta sucursal.');
      if (current.status === 'cancelled') return await reject(409, 'No se puede editar una clase cancelada.');
      if (current.revision !== req.body.revision) return await reject(409, 'La clase cambió mientras la editabas. Cierra el editor y vuelve a abrirlo.');
      const { date, startTime, endTime, maxCapacity, instructorId, classTypeId } = req.body;
      const occupied = await client.query("SELECT COUNT(*)::int AS count FROM bookings WHERE class_id=$1 AND status IN ('confirmed','checked_in','no_show')", [req.params.id]);
      if (maxCapacity < occupied.rows[0].count) return await reject(409, `El cupo no puede ser menor a ${occupied.rows[0].count} reservas existentes.`);
      const coach = await client.query('SELECT id FROM instructors WHERE id=$1', [instructorId]);
      const type = await client.query('SELECT id, name, category FROM class_types WHERE id=$1', [classTypeId]);
      if (!coach.rows.length || !type.rows.length) return await reject(400, 'La coach o el tipo de clase ya no existe.');
      if (branch.code !== 'pozos' && (type.rows[0].category === 'funcional' || /funcional|functional/i.test(type.rows[0].name))) return await reject(400, 'Funcional está disponible solo en Pozos.');
      // Update the existing class, never recreate bookings or modify memberships.
      await client.query(`UPDATE classes SET instructor_id=$3, class_type_id=$4, date=$5,
        start_time=$6, end_time=$7, max_capacity=$8, updated_at=NOW() WHERE id=$1 AND branch_id=$2`,
        [req.params.id, branch.id, instructorId, classTypeId, date, startTime, endTime, maxCapacity]);
      await client.query('COMMIT');
      return res.json({ id: req.params.id, message: 'Clase actualizada. Reservas conservadas.' });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Edit class', error.message);
      return res.status(error.code === '23505' || error.code === '23514' ? 409 : 500).json({ message: 'No se pudo guardar. Revisa el horario y el cupo e intenta de nuevo.' });
    } finally { client?.release(); }
  });
}
