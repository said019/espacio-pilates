import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { RosterName, CancellationHistory } from './RosterIdentity';
afterEach(cleanup);
it('links registered names to the client profile', () => {
  render(<MemoryRouter><RosterName userId="client-id" name="Aidee" /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Aidee' })).toHaveAttribute('href', '/admin/clients/client-id');
});
it('does not invent a profile for guests', () => {
  render(<MemoryRouter><RosterName name="Invitada" /></MemoryRouter>);
  expect(screen.queryByRole('link')).toBeNull();
});
it('shows cancellation origin and Mexico City time', () => {
  render(<MemoryRouter><CancellationHistory rows={[{ bookingId: 'b', userId: 'u', displayName: 'Ana', cancelledAt: '2026-10-22T19:02:28Z', cancelledBy: 'user' }]} /></MemoryRouter>);
  expect(screen.getByText('Canceladas (1)')).toBeInTheDocument();
  expect(screen.getByText('Canceló: Alumna')).toBeInTheDocument();
  expect(screen.getByText(/22\/10\/2026/).textContent).toMatch(/13:02:28|01:02:28/);
});
it('labels missing historical information without guessing', () => {
  render(<MemoryRouter><CancellationHistory rows={[{ bookingId: 'b', displayName: 'Ana' }]} /></MemoryRouter>);
  expect(screen.getByText('Canceló: No registrado')).toBeInTheDocument();
  expect(screen.getByText('Fecha y hora no registradas')).toBeInTheDocument();
});
it('shows an empty history', () => {
  render(<MemoryRouter><CancellationHistory rows={[]} /></MemoryRouter>);
  expect(screen.getByText('Sin cancelaciones registradas.')).toBeInTheDocument();
});
