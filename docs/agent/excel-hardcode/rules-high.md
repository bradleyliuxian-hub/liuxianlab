# excel-hardcode / rules-high (HC001-HC005, HC006)

- HC001 sequence broken by a constant; HC002 reference replaced by a constant;
  HC003 extra constant added; HC005 structural deviation in a dominant pattern;
  HC006 ROUNDING_PLUG (small tail adjustment outside a ROUND body).
- `ROUND(x/1000,digits)` is a normal unit conversion, not a hit.
- Require real structural evidence (consistent neighbors), not density alone.

Authority: `hardcode-core.js` + `tests/excel-hardcode-check/hardcode-core.test.js`.
