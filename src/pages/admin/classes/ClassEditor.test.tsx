import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ClassEditor } from './ClassEditor';
import api from '@/lib/api';
vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
it('loads local date/time and saves the same class with all editable fields', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { data: { date: '2026-10-19', start_time: '08:00:00', end_time: '08:55:00', instructor_id: 'day', class_type_id: 'pilates', max_capacity: 8, revision: 'revision' } } });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  const onSaved = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ClassEditor classId="same-class" branchId="villa" instructors={[{ id: 'day', displayName: 'Day' }, { id: 'edith', displayName: 'Edith' }]} types={[{ id: 'pilates', name: 'Pilates' }]} onSaved={onSaved} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Editar clase' }));
  await screen.findByLabelText('Coach');
  expect(screen.getByLabelText('Fecha')).toHaveValue('2026-10-19');
  expect(screen.getByLabelText('Inicio')).toHaveValue('08:00');
  fireEvent.change(screen.getByLabelText('Coach'), { target: { value: 'edith' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api.put).toHaveBeenCalledWith('/admin/classes/same-class/edit', expect.objectContaining({ branchId: 'villa', instructorId: 'edith', date: '2026-10-19', startTime: '08:00', endTime: '08:55', maxCapacity: 8, classTypeId: 'pilates', revision: 'revision' }));
});
