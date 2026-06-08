# UPDATE runbook — run every ~10 min (the /loop fires this)

Goal: take a fresh ONPE reading, regenerate `data.json`, push to GitHub Pages.
Project dir: `C:\Users\cosmo\Downloads\peru-2026-tracker`

## Steps

1. **Browser (Claude-in-Chrome).** Make sure a tab is open at
   `https://resultadosegundavuelta.onpe.gob.pe/main/resumen`.
   - `tabs_context_mcp` → if no ONPE tab, `tabs_create_mcp` + `navigate` there, wait ~5 s.

2. **Run the engine.** Paste the entire body of `engine.js` into `javascript_tool` on that tab.
   It returns `{"len":…, "payload":"{…numbers…}"}`. The payload is **numbers only** (~900 chars,
   fits one view). Copy the `payload` value (the `{"nat":…,"ext":…,"reg":…}` string).
   - If it throws `dept fail N` or returns HTML, ONPE is overloaded — wait ~20 s and re-run. The
     engine already retries each call 8×.

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

## Tuning the exterior assumption (optional)

The exterior is the decisive, most-uncertain block. As real exterior actas come in, you may adjust
the constants at the top of `build.mjs`:
- `EXT_VPA` — valid votes per acta abroad (currently 120; today's first actas run ~170).
- `EXT_SHARE` — Keiko share low/central/high (currently 0.57 / 0.62 / 0.665).
Editing these and re-running step 3–4 updates the projection. Note the change in the commit message.

## Notes
- ONPE department ids are NOT alphabetical (Callao = 25). The mapping lives in `build.mjs` — don't touch.
- `idEleccion=10` is the presidential runoff. `idAmbitoGeografico=1` = Perú, `=2` = Extranjero.
- The API is only reachable from the live browser session, so this must run via Claude-in-Chrome.
