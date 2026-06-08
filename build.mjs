// build.mjs — turns the compact ONPE payload (from engine.js, run in Claude-in-Chrome)
// into the site's data.json, then appends one history point.
//
//   node build.mjs '<payload>'
//
// engine.js computes the per-region nets at PROVINCE level with shrinkage toward the
// department mean (so 1-acta provinces don't wreck the projection) and applies the JEE
// validation haircut. So this builder just assembles + does the exterior model + history.
//
// payload (numbers only — safe as a shell arg):
//   { "nat":[ts,cont,tot,jee,pend,validos,emitidos,partic,k,s],
//     "ext":[tot,cont,pend,jee,k,s],
//     "reg":[[cont,tot,jee,pend,kSharePct,vpa,netPend,netJee] x25 in dept-id order 1..25] }
import fs from 'node:fs';

const NAME = ['Amazonas','Áncash','Apurímac','Arequipa','Ayacucho','Cajamarca','Cusco',
  'Huancavelica','Huánuco','Ica','Junín','La Libertad','Lambayeque','Lima','Loreto',
  'Madre de Dios','Moquegua','Pasco','Piura','Puno','San Martín','Tacna','Tumbes','Ucayali','Callao'];

// ---- Exterior assumptions (explicit & tweakable) -------------------------
const EXT_VPA = 120;                 // valid votes per acta abroad (2021-like turnout)
const EXT_SHARE = { low:0.57, central:0.62, high:0.665 }; // Keiko share: today's early trend -> 2021
// Province-trend shrinkage (K0) and JEE validation haircut are applied upstream in engine.js.
// --------------------------------------------------------------------------

const raw = process.argv[2];
if (!raw) { console.error('Usage: node build.mjs \'<payload json>\''); process.exit(1); }
const p = JSON.parse(raw);

const [ts, ncont, ntot, njee, npend, validos, emitidos, partic, nk, ns] = p.nat;
const [etot, econt, epend, ejee, ek, es] = p.ext;

let pendNet = 0, jeeNet = 0;
const reg = p.reg.map((r, i) => {
  const [cont, tot, jee, pend, kSh, vpa, nP, nJ] = r;
  pendNet += nP; jeeNet += nJ;
  const pctActas = tot > 0 ? +(cont/tot*100).toFixed(1) : 0;
  return [ NAME[i], pctActas, cont, tot, jee, pend, kSh, vpa, nP, nJ ];
});
pendNet = Math.round(pendNet); jeeNet = Math.round(jeeNet);

const margin   = nk - ns;
const domFinal = margin + pendNet + jeeNet;
const extPendValid = Math.round(epend * EXT_VPA);
const extScen = {};
for (const k in EXT_SHARE) extScen[k] = Math.round(extPendValid * (2*EXT_SHARE[k] - 1));
const finalScen = { low: domFinal+extScen.low, central: domFinal+extScen.central, high: domFinal+extScen.high };

const pctActas = ntot>0 ? +(ncont/ntot*100).toFixed(3) : 0;
const kPct = validos>0 ? +(nk/validos*100).toFixed(3) : 0;
const sPct = validos>0 ? +(ns/validos*100).toFixed(3) : 0;

let label;
try {
  label = new Intl.DateTimeFormat('es-PE', { timeZone:'America/Lima', day:'2-digit', month:'short',
    hour:'2-digit', minute:'2-digit', hour12:true }).format(new Date(ts)).replace('.', '') + ' (hora Perú)';
} catch(_) { label = new Date(ts).toISOString(); }

let history = [];
try { const old = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url))); history = old.history || []; } catch(_) {}
if (!history.length || history[history.length-1][0] !== ts) history.push([ts, margin, finalScen.central]);
if (history.length > 240) history = history.slice(-240);

const out = {
  meta: { updatedAt: ts, updatedAtLabel: label,
    source: 'ONPE — resultadosegundavuelta.onpe.gob.pe (presentacion-backend)', idEleccion: 10,
    method: 'Pendientes y actas-al-JEE proyectadas por tendencia de PROVINCIA, con shrinkage hacia la media del departamento para provincias con pocas actas contadas. JEE con haircut ~2% (validación histórica). Exterior por referencia 2021.',
    note: 'Proyección del conteo ordinario. No es el resultado legal: la proclamación es del JNE.' },
  nat: { pctActas, cont:ncont, tot:ntot, jee:njee, pend:npend, validos, emitidos,
    participacion: +partic.toFixed(3), k:nk, s:ns, kPct, sPct, margin },
  ext: { tot:etot, cont:econt, pend:epend, jee:ejee, k:ek, s:es, vv:ek+es,
    pctActas: etot>0 ? +(econt/etot*100).toFixed(3) : 0 },
  assume: { extVPA: EXT_VPA, extVPAcur: econt>0 ? Math.round((ek+es)/econt) : null,
    extShareLow: EXT_SHARE.low, extShareCentral: EXT_SHARE.central, extShareHigh: EXT_SHARE.high,
    extPendValid,
    ref2021: 'Fujimori ganó el exterior 66.5% a 33.5% sobre Castillo (~302k válidos). En 2021 el JNE validó casi todas las actas observadas: solo ~12 anuladas a nivel nacional.' },
  dom: { pendNet, jeeNet, final: domFinal },
  extScen, finalScen,
  reg,
  history
};

fs.writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`OK  ${label}  |  now ${margin>=0?'K':'S'}+${Math.abs(margin)}  |  dom ${domFinal>=0?'K':'S'}+${Math.abs(domFinal)}  |  proj K+${finalScen.central} (range ${finalScen.low}..${finalScen.high})  |  hist ${history.length}`);
