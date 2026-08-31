export type RosterStatusRow = {
  status?: string | null;
};

export function summarizeRoster(rows: RosterStatusRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (row.status === "confirmed" || row.status === "checked_in") {
        summary.confirmed += 1;
      } else if (row.status === "waitlist") {
        summary.waitlist += 1;
      }
      return summary;
    },
    { confirmed: 0, waitlist: 0 },
  );
}
