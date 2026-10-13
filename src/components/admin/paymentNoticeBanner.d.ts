export function montarAviso(elemento:HTMLElement,options:{endpoint:string;fetchImpl?:typeof fetch;onNotice?:(notice:{fecha:string;ciclo:string;texto:string}|null)=>void}):()=>void;
