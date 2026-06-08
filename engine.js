// engine.js — paste into Claude-in-Chrome (javascript_tool) on a tab open at
// https://resultadosegundavuelta.onpe.gob.pe/main/resumen
// Returns a COMPACT, numbers-only payload (~900 chars, fits one tool view).
// Department-id order 1..25 maps to names in build.mjs (Callao is id 25).
(async () => {
  const base='https://resultadosegundavuelta.onpe.gob.pe/presentacion-backend';
  const sleep=ms=>new Promise(z=>setTimeout(z,ms));
  // robust JSON GET: ONPE is overloaded on election night and intermittently
  // returns 503 or the SPA HTML shell (starts with '<'); retry past both.
  const jget=async(u,tries=8)=>{for(let i=0;i<tries;i++){try{const r=await fetch(u,{cache:'no-store'});
    if(r.status===200){const t=await r.text();if(t&&t[0]!=='<'){try{return JSON.parse(t);}catch(e){}}}}catch(e){}
    await sleep(250+i*200);}return null;};
  const V=(arr,code)=>((arr||[]).find(x=>x.codigoAgrupacionPolitica===code)||{}).totalVotosValidos||0; // 8=Keiko 10=Sánchez
  const dep=async(n)=>{const id=String(n).padStart(2,'0')+'0000';
    const f=`tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&idUbigeoDepartamento=${id}`;
    const [t,p]=await Promise.all([jget(`${base}/resumen-general/totales?idEleccion=10&${f}`),
                                   jget(`${base}/resumen-general/participantes?idEleccion=10&${f}`)]);
    if(!t||!p||!t.data||!p.data)return null;const d=t.data;
    return [d.contabilizadas,d.totalActas,d.enviadasJee,d.pendientesJee,V(p.data,8),V(p.data,10)];};
  const reg=[];
  for(let st=1;st<=25;st+=5){const c=[];for(let n=st;n<Math.min(st+5,26);n++)c.push(dep(n));reg.push(...await Promise.all(c));}
  for(let i=0;i<25;i++){if(!reg[i]){reg[i]=await dep(i+1);}if(!reg[i])throw new Error('dept fail '+(i+1));}
  const nt=await jget(`${base}/resumen-general/totales?idEleccion=10&tipoFiltro=eleccion`);
  const np=await jget(`${base}/resumen-general/participantes?idEleccion=10&tipoFiltro=eleccion`);
  const et=await jget(`${base}/resumen-general/totales?idEleccion=10&tipoFiltro=ambito_geografico&idAmbitoGeografico=2`);
  const ep=await jget(`${base}/resumen-general/participantes?idEleccion=10&tipoFiltro=ambito_geografico&idAmbitoGeografico=2`);
  const nd=nt.data, ed=et.data;
  const nat=[nd.fechaActualizacion,nd.contabilizadas,nd.totalActas,nd.enviadasJee,nd.pendientesJee,
             nd.totalVotosValidos,nd.totalVotosEmitidos,nd.participacionCiudadana,V(np.data,8),V(np.data,10)];
  const ext=[ed.totalActas,ed.contabilizadas,ed.pendientesJee,ed.enviadasJee,V(ep.data,8),V(ep.data,10)];
  const payload=JSON.stringify({nat,ext,reg});
  window.PAYLOAD=payload;
  return JSON.stringify({len:payload.length, payload});
})();
