import {noticeWindow,claimNoticeWindow} from './paymentNoticeFrequency.mjs';
// The endpoint must be the project's own API (same origin, or the configured API origin passed in
// allowedOrigins) and must authorize administrators on the host server.
// Never throw: this mounts inside the admin layout, and an exception there takes down every admin screen.
export function montarAviso(elemento,{endpoint,allowedOrigins=[],fetchImpl=fetch,onNotice=()=>{}}) {
  const url=new URL(endpoint,window.location.origin);
  if(url.origin!==window.location.origin && !allowedOrigins.includes(url.origin)){
    console.warn('[PaymentNotice] Endpoint fuera del proyecto, aviso desactivado.');
    return()=>{};
  }
  let disposed=false,request=0,controller=null,lastDate='',activeSlot='';
  const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hide=()=>{elemento.hidden=true;elemento.textContent='';onNotice(null);};
  elemento.setAttribute('role','status');hide();
  async function refresh(){
    if(disposed)return;
    controller?.abort();controller=new AbortController();const current=++request;
    const ownController=controller;
    const timeout=setTimeout(()=>ownController.abort(),2500);
    try{
      const r=await fetchImpl(url.href,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(!r.ok){hide();return;}const a=(await r.json())?.aviso;
      if(disposed || request!==current || !a || typeof a.texto!=='string' || a.texto.length>300){hide();return;}
      const today=localDate(),due=new Date(a.fecha+'T00:00:00Z');
      if(!Number.isFinite(due.getTime()) || due.toISOString().slice(0,10)!==a.fecha){hide();return;}
      due.setUTCDate(due.getUTCDate()-1);
      if(today!==a.fecha && today!==due.toISOString().slice(0,10)){hide();return;}
      const slot=noticeWindow();
      if(activeSlot!==slot){
        const claimed=await claimNoticeWindow({canShow:()=>!disposed&&request===current&&!document.hidden});
        if(disposed||request!==current)return;
        if(!claimed){hide();return;}
        activeSlot=claimed;
      }
      elemento.textContent=a.texto;elemento.hidden=false;lastDate=today;onNotice({...a,frequencyKey:activeSlot});
    }catch{if(request===current)hide();}finally{clearTimeout(timeout);}
  }
  const visible=()=>{if(!document.hidden)refresh();};
  const periodic=setInterval(visible,300000);
  // Clear stale text across midnight even if a network request fails.
  const midnight=setInterval(()=>{if(localDate()!==lastDate){lastDate=localDate();hide();visible();}},1000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);refresh();
  return()=>{disposed=true;controller?.abort();clearInterval(periodic);clearInterval(midnight);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);hide();};
}
