export const PUSH_SEGMENTS = Object.freeze({
  ALL: "all",
  ACTIVE_MEMBERSHIP: "active_membership",
  RENEWAL_PENDING: "renewal_pending",
});

export function normalizePushSegment(value) {
  return Object.values(PUSH_SEGMENTS).includes(value) ? value : PUSH_SEGMENTS.ALL;
}

export function renewalNotificationAudienceQuery() {
  return `
    SELECT DISTINCT u.id AS user_id
      FROM users u
     WHERE u.role = 'client'
       AND u.is_active IS NOT FALSE
       AND u.receive_reminders IS NOT FALSE
       AND EXISTS (
         SELECT 1
           FROM memberships previous_membership
          WHERE previous_membership.user_id = u.id
            AND previous_membership.status IN ('active', 'expired')
            AND previous_membership.end_date < CURRENT_DATE
       )
       AND NOT EXISTS (
         SELECT 1
           FROM memberships current_membership
          WHERE current_membership.user_id = u.id
            AND current_membership.status = 'active'
            AND (current_membership.start_date IS NULL OR current_membership.start_date <= CURRENT_DATE)
            AND (current_membership.end_date IS NULL OR current_membership.end_date >= CURRENT_DATE)
       )`;
}

// Every query returns one row per subscribed client. Keeping the SQL in one
// place ensures the stats, custom broadcasts and the renewal shortcut target
// exactly the same audience.
export function pushAudienceQuery(segmentValue) {
  const segment = normalizePushSegment(segmentValue);

  if (segment === PUSH_SEGMENTS.ACTIVE_MEMBERSHIP) {
    return `
      SELECT DISTINCT ps.user_id
        FROM push_subscriptions ps
        JOIN users u ON u.id = ps.user_id
       WHERE u.role = 'client'
         AND u.is_active IS NOT FALSE
         AND EXISTS (
           SELECT 1
             FROM memberships m
            WHERE m.user_id = ps.user_id
              AND m.status = 'active'
              AND (m.start_date IS NULL OR m.start_date <= CURRENT_DATE)
              AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
         )`;
  }

  if (segment === PUSH_SEGMENTS.RENEWAL_PENDING) {
    return `
      SELECT DISTINCT ps.user_id
        FROM push_subscriptions ps
        JOIN (${renewalNotificationAudienceQuery()}) eligible
          ON eligible.user_id = ps.user_id
        JOIN users u ON u.id = ps.user_id
       WHERE u.push_reminders IS NOT FALSE`;
  }

  return `
    SELECT DISTINCT ps.user_id
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id
     WHERE u.role = 'client'
       AND u.is_active IS NOT FALSE`;
}
