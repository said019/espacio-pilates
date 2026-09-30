import { afterEach, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); send.mockReset(); });

it('sends the approved renewal message with a checkout link', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-only');
  send.mockResolvedValue({ data: { id: 'accepted-id' }, error: null });
  const { sendMonthlyRenewalReminder } = await import('../../emailService.js');
  expect(await sendMonthlyRenewalReminder({ to: 'test@example.com' })).toEqual({ accepted: true, id: 'accepted-id' });
  expect(send.mock.calls[0][0].html).toContain('Renueva tu membresía');
  expect(send.mock.calls[0][0].html).toContain('/app/checkout');
});

it('does not report provider rejection as accepted', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-only');
  send.mockResolvedValue({ data: null, error: { message: 'rejected' } });
  const { sendMonthlyRenewalReminder } = await import('../../emailService.js');
  expect((await sendMonthlyRenewalReminder({ to: 'test@example.com' })).accepted).toBe(false);
});
