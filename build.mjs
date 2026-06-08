// build.mjs — turns the compact ONPE payload (from engine.js, run in Claude-in-Chrome)
// into the site's data.json, recomputing the projection and appending one history point.
//
//   node build.mjs '<payload>'
//
// payload (numbers only, no strings — safe to pass as a shell arg):
//   { "nat":[ts,cont,tot,jee,pend,validos,emitidos,partic,k,s],
//     "ext":[tot,cont,pend,jee,k,s],
//     "reg":[[cont,tot,jee,pend,k,s] x25 in ONPE department-id order 1..25] }
//
// Department id order is VERIFIED against ONPE (Callao is id 25, not alphabetical):
import fs from 'node:fs';

const NAME = ['Amazonas','Áncash','Apurímac','Arequipa','Ayacucho','Cajamarca','Cusco',
  'Huancavelica','Huánuco','Ica','Junín','La Libertad','Lambayeque','Lima','Loreto',
  'Madre de Dios','Moquegua','Pasco','Piura','Puno','San Martín','Tacna','Tumbes','Ucayali','Callao'];

// ---- Exterior assumptions (explicit & tweakable) -------------------------
const EXT_VPA = 120;                 // valid votes per acta abroad (2021-like turnout)
const EXT_SHARE = { low:0.57, central:0.62, high:0.665 }; // Keiko share: today's early trend → 2021
// --------------------------------------------------------------------------

const raw = process.argv[2];
if (!raw) { console.error('Usage: node build.mjs \'<payload json>\''); process.exit(1); }
const p = JSON.parse(raw);

const [ts, ncont, ntot, njee, npend, validos, emitidos, partic, nk, ns] = p.nat;
const [etot, econt, epend, ejee, ek, es] = p.ext;

let dpK=0, dpS=0, djK=0, djS=0;
const reg = p.reg.map((r, i) => {
  const [cont, tot, jee, pend, k, s] = r;
  const vv = k + s;
  const vpa = cont > 0 ? vv / cont : 0;
  const ks  = vv > 0 ? k / vv : 0.5;
  const pK = pend*vpa*ks, pS = pend*vpa*(1-ks), jK = jee*vpa*ks, jS = jee*vpa*(1-ks);
  dpK+=pK; dpS+=pS; djK+=jK; djS+=jS;
  const pctActas = tot > 0 ? +(cont/tot*100).toFixed(1) : 0;
  return [ NAME[i], pctActas, cont, tot, jee, pend,
           +(ks*100).toFixed(1), Math.round(vpa),
           Math.round(pK-pS), Math.round(jK-jS) ];
});

const margin   = nk - ns;
const pendNet  = Math.round(dpK - dpS);
const jeeNet   = Math.round(djK - djS);
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
    hour:'2-digit', minute:'2-digit', hour12:true }).format(new Date(ts))
    .replace('.', '') + ' (hora Perú)';
} catch(_) { label = new Date(ts).toISOString(); }

// history: append, dedupe by ts, cap 240
let history = [];
try { const old = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url))); history = old.history || []; } catch(_) {}
if (!history.length || history[history.length-1][0] !== ts) history.push([ts, margin, finalScen.central]);
if (history.length > 240) history = history.slice(-240);

const out = {
  meta: { updatedAt: ts, updatedAtLabel: label,
    source: 'ONPE — resultadosegundavuelta.onpe.gob.pe (presentacion-backend)', idEleccion: 10,
    note: 'Proyección del conteo ordinario. No es el resultado legal: la proclamación es del JNE.' },
  nat: { pctActas, cont:ncont, tot:ntot, jee:njee, pend:npend, validos, emitidos,
    participacion: +partic.toFixed(3), k:nk, s:ns, kPct, sPct, margin },
  ext: { tot:etot, cont:econt, pend:epend, jee:ejee, k:ek, s:es, vv:ek+es,
    pctActas: etot>0 ? +(econt/etot*100).toFixed(3) : 0 },
  assume: { extVPA: EXT_VPA, extVPAcur: econt>0 ? Math.round((ek+es)/econt) : null,
    extShareLow: EXT_SHARE.low, extShareCentral: EXT_SHARE.central, extShareHigh: EXT_SHARE.high,
    extPendValid,
    ref2021: 'Fujimori ganó el exterior 66.5% a 33.5% sobre Castillo (~302k válidos, neto ~+99.5k).' },
  dom: { pendNet, jeeNet, final: domFinal,
    pendAddK: Math.round(dpK), pendAddS: Math.round(dpS),
    jeeAddK: Math.round(djK), jeeAddS: Math.round(djS) },
  extScen, finalScen,
  reg,
  history
};

fs.writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`OK  ${label}  |  now ${margin>=0?'K':'S'}+${Math.abs(margin)}  |  proj K+${finalScen.central} (range ${finalScen.low}..${finalScen.high})  |  hist ${history.length}`);
