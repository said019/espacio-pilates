// Copy this file to the host SERVER only. Never bundle its credentials into frontend code.
export async function consultarAviso({baseUrl,token,fetchImpl=fetch,now=()=>new Date()}) {
  if(!token)return null;
  let timer;
  const controller=new AbortController();
  try{
    const origin=new URL(baseUrl);if(origin.protocol!=='https:' || origin.username || origin.password)return null;
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},2000);});
    return await Promise.race([timeout,(async()=>{
      const r=await fetchImpl(`${origin.origin}/api/platform/avisos/actual`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:controller.signal});
      if(!r.ok)return null;
      const raw=await r.text();if(raw.length>4096)return null;
      const a=JSON.parse(raw)?.aviso;
      if(!a || typeof a.texto!=='string' || !a.texto.trim() || a.texto.length>300 || !/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(a.fecha) || a.ciclo!==a.fecha.slice(0,7))return null;
      const due=new Date(a.fecha+'T00:00:00Z');if(!Number.isFinite(due.getTime()) || due.toISOString().slice(0,10)!==a.fecha)return null;
      const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now()).map(p=>[p.type,p.value]));
      const today=`${dateParts.year}-${dateParts.month}-${dateParts.day}`;due.setUTCDate(due.getUTCDate()-1);
      if(today!==a.fecha && today!==due.toISOString().slice(0,10))return null;
      return {ciclo:a.ciclo,fecha:a.fecha,texto:a.texto};
    })()]);
  }catch{return null;}finally{clearTimeout(timer);controller.abort();}
}
