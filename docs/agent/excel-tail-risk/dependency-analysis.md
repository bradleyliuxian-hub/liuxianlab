# excel-tail-risk / dependency-analysis

Reference analysis is the core of tail-risk priority. `reference-map.js` builds
one forward dependency graph over all formulas:

- `adjacency: Map<targetKey, Set<referrerKey>>` — "who directly depends on me".
  A single pass over every formula yields the whole graph (no per-issue rescan).
- `lookup(sheet, address)` -> direct reference count + cross-sheet count + a
  capped referrer sample (直接引用数).
- `downstream(key)` -> `{ count, truncated, hasCycle }` — the number of **unique**
  cells reachable downward (下游引用数). Iterative DFS with colouring:
  - de-duplicated: a node reachable by many paths counts once;
  - cycle-safe: a back-edge sets `hasCycle`, never loops or overflows;
  - bounded by `downstreamCap` (per call) and `downstreamBudget` (whole scan).

Supported reference syntax: same-sheet, cross-sheet, absolute (`$`), relative,
quoted sheet names, names with spaces, escaped single quotes (`'Brad''s Data'`).
Ranges are expanded within a bounded budget (default ≤ 4096 cells/range and
≤ 500k cells/workbook); oversized ranges are matched by containment for the
direct count and do NOT contribute graph edges. Whole-column/row refs (`A:A`)
are not resolved into members. Workbook-defined names are excluded.

Sorting: `risk-core.js` exposes `sortIssues(list, mode)` with modes
`risk` (default = risk, then downstream desc, then direct desc), `downstream`,
`directReferences`, `sheet`. The web list and every exported sheet use the same
comparator, so the top of the list is the widest-reaching tail risk.

Read when: changing reference / dependency / ordering logic.
Authority: `reference-map.js`, `risk-core.js`, `decimal-workbook.js`, tests.
