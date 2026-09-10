// Membership history is intentional: expired clients still belong in renewal lists.
// EXISTS avoids duplicating clients with multiple plans/bookings or both branches.
export function clientBranchPredicate(parameter) {
  if (!/^\$[1-9]\d*$/.test(parameter)) throw new Error('Invalid SQL parameter');
  return `(
    EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.branch_id = ${parameter})
    OR EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = users.id AND e.branch_id = ${parameter})
    OR EXISTS (SELECT 1 FROM orders o WHERE o.user_id = users.id AND o.branch_id = ${parameter}
      AND o.status IN ('pending_payment', 'pending_verification', 'approved'))
    OR EXISTS (SELECT 1 FROM bookings b JOIN classes c ON c.id = b.class_id
      WHERE b.user_id = users.id AND c.branch_id = ${parameter} AND b.status != 'cancelled')
  )`;
}
