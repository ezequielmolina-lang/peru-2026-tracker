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

// ---- Exterior model (LIVE-anchored) -------------------------------------------------
// Centered on the exterior's OWN live trend (Keiko share + votes/acta). Once enough actas
// are counted the 2021 prior is no longer used as a pull — only a light pseudocount (EXT_K0)
// stabilizes the very-sparse phase (<~12 actas). The scenario band is a SAMPLING-ERROR band
// around the live share that narrows as more actas report. (Re-anchored from the 2021 prior
// once ~140 abroad actas consistently showed ~56-57% Keiko, below the 62% historical prior.)
const EXT_PRIOR_KS  = 0.58;   // mild fallback share, only matters when exterior is near-empty
const EXT_PRIOR_VPA = 130;    // mild fallback votes/acta for the near-empty phase
const EXT_K0        = 12;      // small pseudocount — live dominates past ~12 counted actas
// Province-trend shrinkage (K0=25) and JEE validation haircut are applied upstream in engine.js.
// ------------------------------------------------------------------------------------

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

// Exterior: live trend (ek/es/econt), only lightly stabilized for the near-empty phase.
const gKs  = (ek+es) > 0 ? ek/(ek+es) : EXT_PRIOR_KS;       // live Keiko share abroad
const gVpa = econt   > 0 ? (ek+es)/econt : EXT_PRIOR_VPA;   // live votes/acta abroad
const w    = econt/(econt + EXT_K0);                        // weight on live data
const shKs  = w*gKs  + (1-w)*EXT_PRIOR_KS;                  // ≈ live once econt ≫ 12
const shVpa = w*gVpa + (1-w)*EXT_PRIOR_VPA;
const extPendValid = Math.round(epend * shVpa);
// Sampling-error band on the Keiko share: ~±1 s.e., narrows as more actas report.
const extBand = Math.max(0.012, Math.min(0.06, 0.5/Math.sqrt(Math.max(econt,1))));
const extScen = {
  low:     Math.round(epend * shVpa * (2*(shKs - extBand) - 1)),
  central: Math.round(epend * shVpa * (2* shKs            - 1)),
  high:    Math.round(epend * shVpa * (2*(shKs + extBand) - 1)),
};
const finalScen = { low: domFinal+extScen.low, central: domFinal+extScen.central, high: domFinal+extScen.high };

// Milestones in the order certainty actually arrives:
//   1) doméstico SIN JEE al 100%  (known today)
//   2) + voto del exterior        (next hours/days)
//   3) + actas observadas / JEE   (resolved last, weeks, by the JNE) = the final
const extCountedMargin = ek - es;                 // exterior already counted (tiny)
const domCountedMargin = margin - extCountedMargin; // domestic counted only
const hito1 = domCountedMargin + pendNet;          // doméstico 100%, sin JEE, sin exterior
const hito2 = { low:     hito1 + extCountedMargin + extScen.low,
                central: hito1 + extCountedMargin + extScen.central,
                high:    hito1 + extCountedMargin + extScen.high };  // + exterior (hito3 = hito2 + jeeNet = finalScen)
const seq = { domCountedMargin, extCountedMargin, hito1, hito2 };

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
  assume: { extLiveKs: +(gKs*100).toFixed(1), extLiveVpa: Math.round(gVpa), extSampleActas: econt,
    extShrunkKs: +(shKs*100).toFixed(1), extShrunkVpa: Math.round(shVpa), extBand: +(extBand*100).toFixed(1),
    extPendValid,
    ref2021: 'El exterior se proyecta con su tendencia VIVA (no el patrón 2021). En 2021 el JNE validó casi todas las actas observadas: solo ~12 anuladas a nivel nacional.' },
  dom: { pendNet, jeeNet, final: domFinal },
  extScen, finalScen, seq,
  reg,
  history
};

fs.writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`OK  ${label}  |  now ${margin>=0?'K':'S'}+${Math.abs(margin)}  |  dom ${domFinal>=0?'K':'S'}+${Math.abs(domFinal)}  |  proj K+${finalScen.central} (range ${finalScen.low}..${finalScen.high})  |  hist ${history.length}`);
