import { render, screen, fireEvent, waitFor, createEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import Consent from './Consent';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: any) => select({user:{id:'client',displayName:'Clienta Prueba'}}) }));
vi.mock('@/components/layout/ClientLayout', () => ({ default: ({children}: any) => <div>{children}</div> }));

describe('consent signing screen', () => {
  it('requires acceptance and drawn signature and sends the current document version', async () => {
    vi.mocked(api.get).mockResolvedValue({data:{data:{text:'Texto del consentimiento',version:'current',signed:null}}});
    vi.mocked(api.post).mockResolvedValue({data:{}});
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Consent /></MemoryRouter></QueryClientProvider>);
    await screen.findByText('Texto del consentimiento', {}, {timeout:10000});
    const save = screen.getByRole('button',{name:'Aceptar y guardar firma'});
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'adult'}});
    expect(save).toBeDisabled();
    const surface=screen.getByRole('img',{name:'Firma manuscrita'}).parentElement!;
    surface.setPointerCapture=vi.fn();
    surface.getBoundingClientRect=()=>({left:0,top:0,width:600,height:200} as DOMRect);
    for (const [type,x,y] of [['pointerDown',50,30],['pointerMove',300,100],['pointerUp',400,50]] as const) {
      const event=createEvent[type](surface);
      Object.defineProperties(event,{isPrimary:{value:true},pointerId:{value:1},clientX:{value:x},clientY:{value:y}});
      fireEvent(surface,event);
    }
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/consent',expect.objectContaining({accepted:true,version:'current',signerRole:'adult',signerName:'Clienta Prueba',signature:expect.any(Array)})));
  },30000);
});
