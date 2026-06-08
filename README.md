# Perú 2026 · Segunda Vuelta — proyección en vivo

Live projection of Peru's 2026 presidential runoff (**Keiko Fujimori** vs **Roberto Sánchez**)
to 100% of the *conteo ordinario*, built entirely from the official **ONPE** portal.

**Live page:** https://ezequielmolina-lang.github.io/peru-2026-tracker/

It refreshes its own data in the browser every ~90 s, and the underlying `data.json` is
re-generated every ~10 minutes from a fresh ONPE reading.

## What it projects

For every region, the actas still to come are added with **that region's own current trend**:

- **Pendientes** (actas not yet counted) → split like the region's counted actas.
- **Actas para envío al JEE** (observed actas sent to the electoral jury) → also projected at the
  region's trend. ⚠️ This is a *strong* assumption: **924 of the ~1,516 observed actas are Lima's**
  (~63% Keiko), so almost the entire JEE net is Lima. If those resolve differently, the domestic
  picture tilts back toward Sánchez.
- **Voto del exterior** — almost entirely uncounted and historically Fujimorista. Estimated with a
  2021 anchor (Keiko 66.5%) and a floor at today's early trend (~57%). This block **decides the race**.

The headline projection = current count + domestic pending (by trend) + domestic JEE (by trend) +
exterior (scenario). Three exterior scenarios (low / central / high) bracket the result.

## How it works

| File | Role |
|------|------|
| `index.html` | The page. Fetches `data.json` every 90 s and renders everything. |
| `data.json`  | The current snapshot + projection + per-region table + history. Rewritten each cycle. |
| `engine.js`  | Browser snippet (run in Claude-in-Chrome on the ONPE tab) → returns a compact numbers-only payload. |
| `build.mjs`  | `node build.mjs '<payload>'` → recomputes the projection and writes `data.json`. |
| `UPDATE.md`  | The 3-step runbook the 10-minute loop follows. |

ONPE's API (`/presentacion-backend/…`) is only reachable from inside the live SPA session — a plain
server-side `curl` gets the HTML shell — so readings are taken via the browser. Department ids are
**not** alphabetical: ONPE pulls Callao out of the A–Z run (so Cusco = `07`, Lima = `14`) and appends
Callao as `25`. This mapping is verified in `build.mjs`.

## Caveat

This is a projection of the **ordinary count**, not a forecast of the official result. The president-elect
is proclaimed by the **JNE** (mid-July); the universe of observed actas at the JEE weighs on the legal outcome.

*Source: ONPE — resultadosegundavuelta.onpe.gob.pe. Not affiliated with ONPE.*
