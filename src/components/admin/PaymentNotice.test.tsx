import {render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {PaymentNotice} from './PaymentNotice';
beforeEach(()=>{const values=new Map();vi.stubGlobal('localStorage',{getItem:(key)=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),clear:()=>values.clear()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('private payment notice',()=>{
 it('shows text only to admin and sends only session credential to own backend',async()=>{
  localStorage.setItem('auth_token','user-session');
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fetcher=vi.fn(async(url,options)=>{
   expect(new URL(url).pathname).toBe('/api/admin/platform-payment-notice');expect(options.headers.Authorization).toBe('Bearer user-session');
   return new Response(JSON.stringify({aviso:{fecha:now,ciclo:now.slice(0,7),texto:'Recordatorio de prueba'}}),{status:200});
  });vi.stubGlobal('fetch',fetcher);
  const view=render(<PaymentNotice role="admin"/>);
  await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('Recordatorio de prueba'));
  fireEvent.click(screen.getByText('Entendido, continuar'));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent(window,new Event('focus'));
  await waitFor(()=>expect(fetcher.mock.calls.length).toBeGreaterThan(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<PaymentNotice role="client"/>);expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('does not throw when the API lives on another origin',async()=>{
  const {montarAviso}=await import('./paymentNoticeBanner.js');
  const el=document.createElement('div');
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({aviso:null}),{status:200}));
  const stopOther=montarAviso(el,{endpoint:'https://api.example.com/api/admin/platform-payment-notice',fetchImpl:fetcher});
  expect(fetcher).not.toHaveBeenCalled();stopOther();
  const stopAllowed=montarAviso(el,{endpoint:'https://api.example.com/api/admin/platform-payment-notice',allowedOrigins:['https://api.example.com'],fetchImpl:fetcher});
  await waitFor(()=>expect(fetcher).toHaveBeenCalled());stopAllowed();
 });
 it('does not redirect or block when provider is unavailable',async()=>{
  localStorage.setItem('auth_token','user-session');vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
  render(<PaymentNotice role="admin"/>);await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());
 });
});
