// engine.js v2 — paste into Claude-in-Chrome (javascript_tool) on a tab at
// https://resultadosegundavuelta.onpe.gob.pe/main/resumen
//
// Computes per-region nets at PROVINCE level with shrinkage toward the department
// mean (K0=25) so sparse provinces (e.g. 1 counted acta) don't distort the projection,
// and applies a ~2% JEE validation haircut. Lima Metropolitana's JEE actas (the biggest single
// bucket) are resolved at DISTRICT level LIVE every cycle — observed actas keep changing, so
// they're not cached. ~570 calls, ~6s, concurrency-pooled.
//
// Returns {len, payload}. payload (numbers only) =
//   { nat:[ts,cont,tot,jee,pend,validos,emitidos,partic,k,s],
//     ext:[tot,cont,pend,jee,k,s, extNetCentral,extNetLow,extNetHigh,extPendValidProj,effPendKsPct],
//        (k,s = aggregate COUNTED abroad; extNet* = country-by-country projected pending net for Keiko;
//         extPendValidProj = projected pending valid votes; effPendKsPct = pending-weighted Keiko %)
//     reg:[[cont,tot,jee,pend,kSharePct,vpa,netPend,netJee] x25 in dept-id order 1..25] }
// Also stored in window.PAYLOAD. If the returned payload is display-truncated (len>~1100),
// grab the tail with a 2nd call: window.PAYLOAD.slice(1000)
(async () => {
  const base='https://resultadosegundavuelta.onpe.gob.pe/presentacion-backend';
  const t0=performance.now(), BUDGET=40000, K0=25, JEE_VAL=0.98;
  const sleep=ms=>new Promise(z=>setTimeout(z,ms));
  const jget=async(u,tr=4)=>{for(let i=0;i<tr;i++){try{const r=await fetch(u,{cache:'no-store'});
    if(r.status===204)return{__e:1};
    if(r.status===200){const t=await r.text();if(t&&t[0]!=='<'){try{return JSON.parse(t);}catch(e){}}}}catch(e){}await sleep(140+i*110);}return null;};
  const V=(a,c)=>((a||[]).find(x=>x.codigoAgrupacionPolitica===c)||{}).totalVotosValidos||0; // 8=Keiko 10=Sánchez
  const pool=async(th,L)=>{const R=new Array(th.length);let i=0;await Promise.all(Array.from({length:L},async()=>{while(i<th.length){const k=i++;if(performance.now()-t0>BUDGET){R[k]=null;continue;}try{R[k]=await th[k]();}catch(e){R[k]=null;}}}));return R;};
  // 1) departments (trend + fallback)
  const dT=n=>async()=>{const id=String(n).padStart(2,'0')+'0000',f=`tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&idUbigeoDepartamento=${id}`;
    const[a,b]=await Promise.all([jget(`${base}/resumen-general/totales?idEleccion=10&${f}`),jget(`${base}/resumen-general/participantes?idEleccion=10&${f}`)]);
    const d=a.data;return{n,id,cont:d.contabilizadas,tot:d.totalActas,jee:d.enviadasJee,pend:d.pendientesJee,k:V(b.data,8),s:V(b.data,10)};};
  const deps=await pool(Array.from({length:25},(_,i)=>dT(i+1)),16);
  // 2) provinces (nivel_02) for departments with remaining >= 8 (store province id)
  const tg=deps.filter(d=>d&&d.jee+d.pend>=8), pT=[];
  for(const d of tg)for(let pp=1;pp<=13;pp++)pT.push((function(id,pp){return async()=>{
    const pid=id.slice(0,2)+String(pp).padStart(2,'0')+'00',f=`tipoFiltro=ubigeo_nivel_02&idAmbitoGeografico=1&idUbigeoDepartamento=${id}&idUbigeoProvincia=${pid}`;
    const t=await jget(`${base}/resumen-general/totales?idEleccion=10&${f}`);if(!t||t.__e||!t.data||t.data.totalActas===0)return null;const d=t.data;
    let k=0,s=0,got=0;if(d.enviadasJee+d.pendientesJee>0){const q=await jget(`${base}/resumen-general/participantes?idEleccion=10&${f}`);if(q&&q.data){k=V(q.data,8);s=V(q.data,10);got=1;}}
    return{dep:id,pid,cont:d.contabilizadas,jee:d.enviadasJee,pend:d.pendientesJee,k,s,got};};})(d.id,pp));
  const provs=(await pool(pT,16)).filter(Boolean);
  const byId={};for(const p of provs)(byId[p.dep]=byId[p.dep]||[]).push(p);

  // 2b) Lima Metropolitana (prov 140100): drill to DISTRICT level LIVE every cycle — it is
  // the biggest JEE bucket and observed actas keep changing (new ones appear, the JNE
  // resolves others), so it must stay current, not cached. 43 districts (Keiko 53%–84%),
  // shrinkage K0=25. ~86 calls. Returns district-level [pendNet, jeeNet] override.
  let limaDist=null;
  const lm=(byId['140000']||[]).find(p=>p.pid==='140100'&&p.got&&p.k+p.s>0);
  if(lm){const lks=lm.k/(lm.k+lm.s),lvp=(lm.k+lm.s)/lm.cont;
    const dThunks=[];for(let dd=1;dd<=43;dd++)dThunks.push((function(dd){return async()=>{
      const id='1401'+String(dd).padStart(2,'0'),f=`tipoFiltro=ubigeo_nivel_03&idAmbitoGeografico=1&idUbigeoDepartamento=140000&idUbigeoProvincia=140100&idUbigeoDistrito=${id}`;
      const t=await jget(`${base}/resumen-general/totales?idEleccion=10&${f}`,3);if(!t||t.__e||!t.data||t.data.totalActas===0)return null;const d=t.data;
      let k=0,s=0,got=0;if(d.enviadasJee+d.pendientesJee>0){const q=await jget(`${base}/resumen-general/participantes?idEleccion=10&${f}`,3);if(q&&q.data){k=V(q.data,8);s=V(q.data,10);got=1;}}
      return{cont:d.contabilizadas,jee:d.enviadasJee,pend:d.pendientesJee,k,s,got};};})(dd));
    const ds=(await pool(dThunks,16)).filter(Boolean);
    let sp=0,sj=0,acc=0,accj=0;
    for(const x of ds){const vv=x.k+x.s;
      if(x.got&&vv>0){const w=x.cont/(x.cont+K0),ks=w*(x.k/vv)+(1-w)*lks,vp=w*(vv/x.cont)+(1-w)*lvp,u=vp*(2*ks-1);sp+=x.pend*u;sj+=x.jee*u;}
      else{const u=lvp*(2*lks-1);sp+=x.pend*u;sj+=x.jee*u;}
      acc+=x.pend;accj+=x.jee;}
    const u=lvp*(2*lks-1);sp+=(lm.pend-acc)*u;sj+=(lm.jee-accj)*u; // remainder at province trend
    limaDist=[sp,sj];}

  // 3) shrinkage net per department (Lima-Metro province uses its district-level override)
  const reg=[];
  for(const d of deps){const vv=d.k+d.s,dks=vv>0?d.k/vv:.5,dvp=d.cont>0?vv/d.cont:0;
    let sp=0,sj=0,acc=0,accj=0;const ps=byId[d.id]||[];
    for(const p of ps){const pv=p.k+p.s;
      if(p.pid==='140100'&&limaDist){sp+=limaDist[0];sj+=limaDist[1];}
      else if(p.got&&pv>0){const w=p.cont/(p.cont+K0),ks=w*(p.k/pv)+(1-w)*dks,vp=w*(p.cont>0?pv/p.cont:dvp)+(1-w)*dvp,u=vp*(2*ks-1);sp+=p.pend*u;sj+=p.jee*u;}
      else{const u=dvp*(2*dks-1);sp+=p.pend*u;sj+=p.jee*u;}
      acc+=p.pend;accj+=p.jee;}
    const u=dvp*(2*dks-1);sp+=(d.pend-acc)*u;sj+=(d.jee-accj)*u; // remainder at dept trend
    reg.push([d.cont,d.tot,d.jee,d.pend,+(100*dks).toFixed(1),Math.round(dvp),Math.round(sp),Math.round(sj*JEE_VAL)]);}
  // 4) national
  const nt=await jget(`${base}/resumen-general/totales?idEleccion=10&tipoFiltro=eleccion`),np=await jget(`${base}/resumen-general/participantes?idEleccion=10&tipoFiltro=eleccion`);
  const nd=nt.data;
  const nat=[nd.fechaActualizacion,nd.contabilizadas,nd.totalActas,nd.enviadasJee,nd.pendientesJee,nd.totalVotosValidos,nd.totalVotosEmitidos,nd.participacionCiudadana,V(np.data,8),V(np.data,10)];
  // 5) EXTERIOR projected COUNTRY BY COUNTRY (continente->país), shrinkage hacia la media del continente.
  // Each country projects its own pending actas with ITS OWN Keiko share + votes/acta; thin-sample
  // countries shrink toward their continent mean (EXT_K0c). Band = ±1 s.e. propagated across countries
  // (per-country share s.e. ≈ 0.5/√actas, clamped), so it widens when the pending sits in under-sampled
  // countries. Replaces the old single-global-share model (which the USA's 82% inflated). ~150 calls, ~1s.
  const EXT_K0c=8;
  const conts=await jget(`${base}/ubigeos/departamentos?idEleccion=10&idAmbitoGeografico=2`);
  const ctyT=[];
  for(const c of ((conts&&conts.data)||[])){const pr=await jget(`${base}/ubigeos/provincias?idEleccion=10&idAmbitoGeografico=2&idUbigeoDepartamento=${c.ubigeo}`);
    if(pr&&pr.data)for(const p of pr.data)ctyT.push((function(cc,pp){return async()=>{
      const f=`tipoFiltro=ubigeo_nivel_02&idAmbitoGeografico=2&idUbigeoDepartamento=${cc}&idUbigeoProvincia=${pp}`;
      const tt=await jget(`${base}/resumen-general/totales?idEleccion=10&${f}`);if(!tt||tt.__e||!tt.data)return null;const d=tt.data;
      let k=0,s=0;if(d.contabilizadas>0){const q=await jget(`${base}/resumen-general/participantes?idEleccion=10&${f}`);if(q&&q.data){k=V(q.data,8);s=V(q.data,10);}}
      return{cont:cc,contadas:d.contabilizadas,pend:d.pendientesJee,k,s};};})(c.ubigeo,p.ubigeo));}
  const cty=(await pool(ctyT,16)).filter(Boolean);
  const cmean={};let GK=0,GS=0,GC=0;
  for(const r of cty){const m=cmean[r.cont]=cmean[r.cont]||{k:0,s:0,c:0};m.k+=r.k;m.s+=r.s;m.c+=r.contadas;GK+=r.k;GS+=r.s;GC+=r.contadas;}
  const gks=(GK+GS)>0?GK/(GK+GS):0.6, gvp=GC>0?(GK+GS)/GC:130;
  for(const id in cmean){const m=cmean[id];m.ks=(m.k+m.s)>0?m.k/(m.k+m.s):gks;m.vp=m.c>0?(m.k+m.s)/m.c:gvp;}
  let extC=0,extPV=0,varV=0;
  for(const r of cty){if(r.pend<=0)continue;const vv=r.k+r.s,m=cmean[r.cont]||{ks:gks,vp:gvp};
    const w=r.contadas/(r.contadas+EXT_K0c);
    const ks=w*(vv>0?r.k/vv:m.ks)+(1-w)*m.ks, vp=w*(r.contadas>0?vv/r.contadas:m.vp)+(1-w)*m.vp;
    const vol=r.pend*vp; extPV+=vol; extC+=vol*(2*ks-1);
    const se=Math.max(0.015,Math.min(0.12, r.contadas>0?0.5/Math.sqrt(r.contadas):0.10));
    varV+=(2*vol*se)*(2*vol*se);}
  const seV=Math.sqrt(varV);
  // aggregate exterior totals (authoritative, for headline display)
  const et=await jget(`${base}/resumen-general/totales?idEleccion=10&tipoFiltro=ambito_geografico&idAmbitoGeografico=2`),ep=await jget(`${base}/resumen-general/participantes?idEleccion=10&tipoFiltro=ambito_geografico&idAmbitoGeografico=2`);
  const ed=et.data;
  const ext=[ed.totalActas,ed.contabilizadas,ed.pendientesJee,ed.enviadasJee,V(ep.data,8),V(ep.data,10),
    Math.round(extC),Math.round(extC-seV),Math.round(extC+seV),Math.round(extPV),+(extPV>0?50*(extC/extPV+1):0).toFixed(1)];
  const payload=JSON.stringify({nat,ext,reg});
  window.PAYLOAD=payload;
  // Return only the first slice (full payload truncates in the tool view). Get the tail
  // with a 2nd call: window.PAYLOAD.slice(540), then concatenate s0 + tail.
  return JSON.stringify({len:payload.length, sec:+((performance.now()-t0)/1000).toFixed(1), s0:payload.slice(0,540)});
})();
