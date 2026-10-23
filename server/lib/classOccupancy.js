// Caller must hold the class row lock in the same transaction.
// Match GET /classes: waitlist, cancellations and absences do not occupy seats.
export async function refreshClassOccupancy(client, classId) {
  const result = await client.query(
    "SELECT COUNT(*)::int AS count FROM bookings WHERE class_id=$1 AND status IN ('confirmed','checked_in')",
    [classId],
  );
  const count = Number(result.rows[0].count);
  await client.query('UPDATE classes SET current_bookings=$2 WHERE id=$1 AND current_bookings IS DISTINCT FROM $2', [classId, count]);
  return count;
}
