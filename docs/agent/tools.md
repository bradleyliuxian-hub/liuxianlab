# Adding a dashboard tool + UI direction

Read on demand.

## Add a tool

1. Add a card entry to `config/tools.json` (source of truth). A card alone shows the shared "开发中" placeholder (`private/tool.html`).
2. To implement it, create `private/tools/<slug>/`:
   ```text
   private/tools/<slug>/
   ├── index.html
   ├── styles.css   (or tool.css)
   └── script.js    (or tool.js)
   ```
   Copy `private/tools/_template/` as a starting point.
3. `server.js` auto-detects `private/tools/<slug>/index.html`. If present, `/tools/<slug>` loads the real tool; otherwise the placeholder is shown.
4. Any new API must mount behind `requireAuth` (and `sameOriginForStateChange` for state changes) in `server.js`.

## Slug rules

- `safeToolSlug` allows `^[a-z0-9][a-z0-9-]{0,63}$` — lowercase letters, digits, hyphen.

## UI direction

- Warm off-white background, fluorescent lime accent.
- Minimal, editorial, productivity-oriented; strong typography, restrained borders, generous whitespace.
- Avoid generic gradient-heavy SaaS styling.
- Concise, natural Chinese copy.
- Excellent mobile behavior and dark mode.
- Reuse `private/tool.css` shared styles where possible.

## Complexity

- A static/front-end-only tool is SIMPLE/MEDIUM (builder + minimal verify).
- A tool with new routes/jobs is MEDIUM; one with persistence/migrations/workers is COMPLEX (AGENTS §5).
