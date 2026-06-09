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

// ---- Exterior model (COUNTRY BY COUNTRY) --------------------------------------------
// The exterior projection is now computed UPSTREAM in engine.js: each country projects its own
// pending actas with its OWN Keiko share + votes/acta, with shrinkage toward the continent mean
// for thin-sample countries, and a band = ±1 s.e. propagated across countries. build.mjs just
// reads the precomputed net (central/low/high) + projected pending volume from the payload.
// (Replaced the old single-global-share model, which the USA's 82% inflated by ~20k.)
// Province-trend shrinkage (K0=25) and JEE validation haircut are also applied upstream in engine.js.
// ------------------------------------------------------------------------------------

const raw = process.argv[2];
if (!raw) { console.error('Usage: node build.mjs \'<payload json>\''); process.exit(1); }
const p = JSON.parse(raw);

const [ts, ncont, ntot, njee, npend, validos, emitidos, partic, nk, ns] = p.nat;
const [etot, econt, epend, ejee, ek, es, extC, extLo, extHi, extPV, effKs] = p.ext;

// Guard: a flaky/overloaded ONPE scrape can yield null/NaN nets for a region (e.g. a Datem
// district call timed out). Refuse to write a corrupt data.json — abort so the loop skips this
// cycle and the live site keeps the last good projection. (engine.js also guards datemDist.)
for (const r of p.reg) if (!Number.isFinite(r[6]) || !Number.isFinite(r[7])) {
  console.error('ABORT: non-finite region net (flaky scrape) — not writing data.json:', JSON.stringify(r));
  process.exit(2);
}
if (![ts,ncont,nk,ns,extC,extLo,extHi].every(Number.isFinite)) {
  console.error('ABORT: non-finite nat/ext value (flaky scrape) — not writing data.json'); process.exit(2);
}

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

// Exterior: country-by-country projection computed upstream in engine.js (extC/extLo/extHi).
const extScen = { low: extLo, central: extC, high: extHi };
// Display helpers: aggregate COUNTED trend abroad vs the projected pending mix.
const gKs   = (ek+es) > 0 ? ek/(ek+es) : 0;        // counted Keiko share abroad (headline)
const gVpa  = econt   > 0 ? (ek+es)/econt : 0;     // counted votes/acta abroad (headline)
const projKs  = effKs;                              // pending-weighted projected Keiko % (país-por-país)
const projVpa = epend > 0 ? extPV/epend : 0;        // projected mean votes/acta on pending
const extPendValid = extPV;                         // projected pending valid votes
const extBand = extPV > 0 ? 100*(extHi-extC)/extPV/2 : 0; // band as ±pp on the share
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
    method: 'Pendientes y actas-al-JEE por tendencia de PROVINCIA (shrinkage hacia el departamento). Exterior proyectado PAÍS POR PAÍS (tendencia y votos/acta de cada país, shrinkage hacia el continente). JEE con haircut ~2%.',
    note: 'Proyección del conteo ordinario. No es el resultado legal: la proclamación es del JNE.' },
  nat: { pctActas, cont:ncont, tot:ntot, jee:njee, pend:npend, validos, emitidos,
    participacion: +partic.toFixed(3), k:nk, s:ns, kPct, sPct, margin },
  ext: { tot:etot, cont:econt, pend:epend, jee:ejee, k:ek, s:es, vv:ek+es,
    pctActas: etot>0 ? +(econt/etot*100).toFixed(3) : 0 },
  assume: { extLiveKs: +(gKs*100).toFixed(1), extLiveVpa: Math.round(gVpa), extSampleActas: econt,
    extShrunkKs: +projKs.toFixed(1), extShrunkVpa: Math.round(projVpa), extBand: +extBand.toFixed(1),
    extPendValid,
    ref2021: 'El exterior se proyecta PAÍS POR PAÍS: cada país aporta sus actas pendientes con su propia tendencia (Keiko %) y sus propios votos por acta, con shrinkage hacia la media del continente donde hay pocas actas. (Ya no se usa una sola tasa global, que el 82% de EE.UU. inflaba.)' },
  dom: { pendNet, jeeNet, final: domFinal },
  extScen, finalScen, seq,
  reg,
  history
};

fs.writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`OK  ${label}  |  now ${margin>=0?'K':'S'}+${Math.abs(margin)}  |  dom ${domFinal>=0?'K':'S'}+${Math.abs(domFinal)}  |  proj K+${finalScen.central} (range ${finalScen.low}..${finalScen.high})  |  hist ${history.length}`);
