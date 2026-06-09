# UPDATE runbook — run every ~10 min (the /loop fires this)

Goal: take a fresh ONPE reading, regenerate `data.json`, push to GitHub Pages.
Project dir: `C:\Users\cosmo\Downloads\peru-2026-tracker`

## Steps

1. **Browser (Claude-in-Chrome).** Make sure a tab is open at
   `https://resultadosegundavuelta.onpe.gob.pe/main/resumen`.
   - `tabs_context_mcp` → if no ONPE tab, `tabs_create_mcp` + `navigate` there, wait ~5 s.

2. **Run the engine.** Paste the entire body of `engine.js` into `javascript_tool` on that tab.
   It computes province-level nets with shrinkage, drills Lima Metro (140100) + Loreto·Datem
   del Marañón (150700) to district level, and projects the exterior country-by-country
   (~580 calls, ~5 s). It returns `{"len":~997, "sec":…, "s0":"<first 540 chars>"}` and stores
   the full payload in `window.PAYLOAD`. Then make a **2nd** tiny call: `window.PAYLOAD.slice(540)` to get the tail.
   Concatenate `s0 + tail` → the full payload `{"nat":…,"ext":…,"reg":…}` (numbers only, ASCII-safe).
   - If a value is null / it returns HTML, ONPE is overloaded — wait ~20 s and re-run. The engine
     retries each call and uses a 40 s budget + concurrency pool.

3. **Build.** In the project dir:
   ```
   node build.mjs '<payload>'
   ```
   (single-quote the payload; it contains no single quotes). It prints a one-line summary and
   rewrites `data.json` (recomputes the projection, appends one history point).

4. **Publish.**
   ```
   git -C "C:/Users/cosmo/Downloads/peru-2026-tracker" add -A
   git -C "C:/Users/cosmo/Downloads/peru-2026-tracker" commit -m "data: <Lima time> — <margin>"
   git -C "C:/Users/cosmo/Downloads/peru-2026-tracker" push
   ```
   GitHub Pages redeploys in ~30–60 s; the live page picks it up on its next 90 s fetch.

5. Done. Do **not** redesign anything — only `data.json` changes each cycle. Keep `index.html`,
   `build.mjs`, `engine.js` stable unless explicitly asked.

## Exterior model (no hand-tuning)

The exterior is the decisive, most-uncertain block, but it is **no longer hand-tuned**. It is
projected COUNTRY BY COUNTRY inside `engine.js`: each country projects its own pending actas with
its own Keiko share + votes/acta, shrunk toward its continent mean (`EXT_K0c=8`), and the band is
±1 s.e. propagated across countries. `build.mjs` just reads the precomputed `ext` net (central/
low/high) from the payload. The old `EXT_VPA` / `EXT_SHARE` constants are gone — don't look for
them. Change this only if explicitly asked, and only by editing the exterior block in `engine.js`.

## Notes
- ONPE department ids are NOT alphabetical (Callao = 25). The mapping lives in `build.mjs` — don't touch.
- `idEleccion=10` is the presidential runoff. `idAmbitoGeografico=1` = Perú, `=2` = Extranjero.
- The API is only reachable from the live browser session, so this must run via Claude-in-Chrome.
