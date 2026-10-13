import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../ui/dialog';
import {montarAviso} from './paymentNoticeBanner.js';
export function PaymentNotice({role}:{role?:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const [notice,setNotice]=useState<{fecha:string;ciclo:string;texto:string}|null>(null);
  const [dismissed,setDismissed]=useState('');
  const allowed=role==='admin'||role==='super_admin';
  useEffect(()=>{
    if(!allowed||!ref.current)return;
    return montarAviso(ref.current,{
      endpoint:new URL(String(import.meta.env.VITE_API_URL || '/api').replace(/["']+/g, '').replace(/\/+$/, '')+'/admin/platform-payment-notice',window.location.origin).href,
      onNotice:setNotice,
      fetchImpl:(url,options)=>{
        const token=localStorage.getItem('auth_token');
        if(!token)return Promise.resolve(new Response('',{status:401}));
        return fetch(url,{...options,headers:{Authorization:`Bearer ${token}`}});
      },
    });
  },[allowed]);
  if(!allowed)return null;
  const key=notice?`${notice.fecha}:${notice.texto}`:'';
  return <>
    <div className="hidden" aria-hidden="true"><div ref={ref} hidden/></div>
    <Dialog open={!!notice&&dismissed!==key} onOpenChange={open=>{if(!open)setDismissed(key);}}>
      <DialogContent className="rounded-2xl max-w-md p-6 sm:p-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Tu plataforma · Recordatorio</p>
        <DialogTitle>Fecha de pago de tu plataforma</DialogTitle>
        <DialogDescription>{notice?.texto}</DialogDescription>
        <p className="text-sm text-muted-foreground">Este aviso es informativo. Puedes cerrarlo y continuar trabajando.</p>
        <button className="rounded-lg bg-primary px-5 py-3 text-primary-foreground" onClick={()=>setDismissed(key)}>Entendido, continuar</button>
      </DialogContent>
    </Dialog>
  </>;
}
