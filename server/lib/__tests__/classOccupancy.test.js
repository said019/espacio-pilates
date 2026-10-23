import { expect, it, vi } from 'vitest';
import { refreshClassOccupancy } from '../classOccupancy.js';
it.each([0, 4, 6])('reconciles occupied seats to %s instead of trusting cached counts', async count => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ count }] }).mockResolvedValueOnce({ rows: [] });
  expect(await refreshClassOccupancy({ query }, 'class')).toBe(count);
  expect(query.mock.calls[0][0]).toContain("status IN ('confirmed','checked_in')");
  expect(query.mock.calls[1][1]).toEqual(['class', count]);
});
