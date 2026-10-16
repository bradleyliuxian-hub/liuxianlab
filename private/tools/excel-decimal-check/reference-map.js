'use strict';

/*
 * Liuxian Lab — Excel 尾差检查: formula reference extractor + reference graph.
 *
 * Pure, dependency-free, read-only. Answers two questions for the tail-risk
 * tool:
 *   - direct:      how many formulas reference this cell (直接引用数)
 *   - downstream:  how many *unique* cells are reachable downward through the
 *                  dependency graph (下游引用数) — cycle-safe and de-duplicated.
 *
 * Scope: this is a real (forward) dependency graph with transitive reachability,
 * but it is built from *expanded* references only. Oversized ranges are kept as
 * ranges for direct containment matching and do NOT contribute graph edges.
 *
 * It carries NO hardcode/constant-role semantics — that belongs to the
 * excel-hardcode tool and must not leak in here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DecimalReferenceMap = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY_SEP = '!'; // Excel sheet names cannot contain '!'

  function columnIndex(letters) {
    const text = String(letters || '').toUpperCase();
    let n = 0;
    for (let i = 0; i < text.length; i += 1) n = n * 26 + (text.charCodeAt(i) - 64);
    return n - 1;
  }

  function columnLabel(index) {
    let n = Number(index);
    let label = '';
    while (n >= 0) {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  }

  function normalizeAddress(row, col) {
    return columnLabel(col) + (Number(row) + 1);
  }

  function makeKey(sheetName, address) {
    return String(sheetName == null ? '' : sheetName) + KEY_SEP + String(address == null ? '' : address).toUpperCase();
  }

  function keySheet(key) {
    const i = key.indexOf(KEY_SEP);
    return i === -1 ? '' : key.slice(0, i);
  }

  function readRefToken(body, pos) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})/.exec(body.slice(pos));
    if (!m) return null;
    const after = body[pos + m[0].length];
    if (after && /[A-Za-z0-9_$]/.test(after)) return null;
    if (after === '(') return null;
    return { col: columnIndex(m[1]), row: Number(m[2]) - 1, next: pos + m[0].length, raw: m[0] };
  }

  function readRangeOrRef(body, pos) {
    const first = readRefToken(body, pos);
    if (!first) return null;
    let end = { col: first.col, row: first.row };
    let next = first.next;
    if (body[next] === ':') {
      const second = readRefToken(body, next + 1);
      if (second) {
        end = { col: second.col, row: second.row };
        next = second.next;
      }
    }
    return { start: { col: first.col, row: first.row }, end, next };
  }

  function readQuotedSheetName(body, pos) {
    let j = pos + 1;
    let name = '';
    while (j < body.length) {
      const ch = body[j];
      if (ch === "'") {
        if (body[j + 1] === "'") { name += "'"; j += 2; } else { j += 1; break; }
      } else { name += ch; j += 1; }
    }
    return { name, next: j };
  }

  function extractReferences(formula, currentSheet, definedNames) {
    const body = String(formula == null ? '' : formula).replace(/^=/, '');
    const names = definedNames instanceof Set ? definedNames : new Set();
    const out = [];
    const n = body.length;
    let i = 0;

    const emit = (sheet, range) => {
      const isRange = range.start.row !== range.end.row || range.start.col !== range.end.col;
      out.push({
        sheet: sheet == null ? null : sheet,
        kind: isRange ? 'range' : 'cell',
        address: normalizeAddress(range.start.row, range.start.col),
        start: { row: range.start.row, col: range.start.col },
        end: { row: range.end.row, col: range.end.col }
      });
    };

    while (i < n) {
      const ch = body[i];

      if (ch === '"') {
        i += 1;
        while (i < n) {
          if (body[i] === '"') {
            if (body[i + 1] === '"') i += 2; else { i += 1; break; }
          } else i += 1;
        }
        continue;
      }

      if (ch === "'") {
        const quoted = readQuotedSheetName(body, i);
        if (body[quoted.next] === '!') {
          const range = readRangeOrRef(body, quoted.next + 1);
          if (range) { emit(quoted.name, range); i = range.next; continue; }
          i = quoted.next + 1; continue;
        }
        i = quoted.next;
        continue;
      }

      if (/[A-Za-z_$\u4e00-\u9fff]/.test(ch)) {
        const sheetMatch = /^([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*)!/.exec(body.slice(i));
        if (sheetMatch) {
          const sheetName = sheetMatch[1];
          const afterBang = i + sheetMatch[0].length;
          const range = readRangeOrRef(body, afterBang);
          if (range) { emit(sheetName, range); i = range.next; continue; }
          i = afterBang;
          continue;
        }

        const range = readRangeOrRef(body, i);
        if (range) {
          const raw = range.start.row === range.end.row && range.start.col === range.end.col
            ? normalizeAddress(range.start.row, range.start.col)
            : '';
          if (!raw || !names.has(raw)) { emit(null, range); i = range.next; continue; }
        }

        let j = i;
        if (body[j] === '$') j += 1;
        while (j < n && /[A-Za-z0-9_.]/.test(body[j])) j += 1;
        i = j;
        continue;
      }

      i += 1;
    }

    return out;
  }

  function collectDefinedNames(workbook) {
    const set = new Set();
    const names = workbook && workbook.Workbook && workbook.Workbook.Names;
    if (Array.isArray(names)) {
      names.forEach((entry) => {
        if (entry && entry.Name) set.add(String(entry.Name).toUpperCase());
      });
    }
    return set;
  }

  /*
   * Build the reference graph over the whole workbook.
   *
   * adjacency: Map<targetKey, Set<referrerKey>> — "who directly depends on me".
   *            Traversing referrer edges yields the downstream closure.
   *
   * Returns:
   *   lookup(sheetName, address) -> { hasReference, directCount, crossSheetCount,
   *                                   crossSheet, referrers, viaRange }
   *   downstream(key, options)   -> { count, truncated, hasCycle }
   *   stats()
   */
  function buildReferenceMap(workbook, options) {
    const opts = options || {};
    const rangeExpandLimit = opts.rangeExpandLimit == null ? 4096 : opts.rangeExpandLimit;
    const expansionBudget = opts.expansionBudget == null ? 500000 : opts.expansionBudget;
    const referrerCap = opts.referrerCap == null ? 50 : opts.referrerCap;
    const largeRangeCap = opts.largeRangeCap == null ? 20000 : opts.largeRangeCap;
    const downstreamCap = opts.downstreamCap == null ? 20000 : opts.downstreamCap;
    const downstreamBudget = opts.downstreamBudget == null ? 5000000 : opts.downstreamBudget;

    const adjacency = new Map(); // targetKey -> Set(referrerKey)
    const largeRanges = [];      // { sheet, rowStart, rowEnd, colStart, colEnd, referrer }
    let formulaCells = 0;
    let referenceEdges = 0;
    let expandedRangeCells = 0;
    let unexpandedRanges = 0;
    let budgetLeft = expansionBudget;
    let downstreamBudgetLeft = downstreamBudget;
    let budgetExhausted = false;

    const definedNames = collectDefinedNames(workbook);

    function addEdge(sheetName, address, referrerKey) {
      const key = makeKey(sheetName, address);
      let set = adjacency.get(key);
      if (!set) { set = new Set(); adjacency.set(key, set); }
      set.add(referrerKey);
    }

    (workbook && workbook.SheetNames ? workbook.SheetNames : []).forEach((sheetName) => {
      const ws = workbook.Sheets[sheetName];
      if (!ws) return;
      Object.keys(ws).forEach((key) => {
        if (key.charAt(0) === '!') return;
        const cell = ws[key];
        if (!cell || !cell.f) return;
        formulaCells += 1;
        const referrerKey = makeKey(sheetName, String(key).toUpperCase());
        const refs = extractReferences(cell.f, sheetName, definedNames);
        refs.forEach((ref) => {
          referenceEdges += 1;
          const targetSheet = ref.sheet == null ? sheetName : ref.sheet;
          if (ref.kind === 'cell') {
            addEdge(targetSheet, ref.address, referrerKey);
            return;
          }
          const rowStart = Math.min(ref.start.row, ref.end.row);
          const rowEnd = Math.max(ref.start.row, ref.end.row);
          const colStart = Math.min(ref.start.col, ref.end.col);
          const colEnd = Math.max(ref.start.col, ref.end.col);
          const area = (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
          if (area <= rangeExpandLimit && budgetLeft >= area) {
            budgetLeft -= area;
            for (let r = rowStart; r <= rowEnd; r += 1) {
              for (let c = colStart; c <= colEnd; c += 1) {
                addEdge(targetSheet, normalizeAddress(r, c), referrerKey);
              }
            }
            expandedRangeCells += area;
          } else {
            unexpandedRanges += 1;
            if (largeRanges.length < largeRangeCap) {
              largeRanges.push({ sheet: targetSheet, rowStart, rowEnd, colStart, colEnd, referrer: referrerKey });
            }
          }
        });
      });
    });

    function largeRangeHits(sheetName, row, col) {
      const hits = [];
      for (let i = 0; i < largeRanges.length; i += 1) {
        const r = largeRanges[i];
        if (r.sheet !== sheetName) continue;
        if (row >= r.rowStart && row <= r.rowEnd && col >= r.colStart && col <= r.colEnd) hits.push(r);
      }
      return hits;
    }

    function lookup(sheetName, address) {
      const parsed = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(address == null ? '' : address).trim());
      const key = makeKey(sheetName, address);
      const set = adjacency.get(key);
      let directCount = set ? set.size : 0;
      let crossSheetCount = 0;
      const referrers = [];
      let viaRange = false;

      if (set) {
        set.forEach((refKey) => {
          if (keySheet(refKey) !== sheetName) crossSheetCount += 1;
          if (referrers.length < referrerCap) {
            const cell = refKey.slice(refKey.indexOf(KEY_SEP) + 1);
            referrers.push({ sheet: keySheet(refKey), cell });
          }
        });
      }

      if (parsed) {
        const row = Number(parsed[2]) - 1;
        const col = columnIndex(parsed[1]);
        const hits = largeRangeHits(sheetName, row, col);
        if (hits.length) {
          viaRange = true;
          directCount += hits.length;
          hits.forEach((hit) => {
            if (hit.sheet !== sheetName) crossSheetCount += 1;
            if (referrers.length < referrerCap) {
              referrers.push({ sheet: keySheet(hit.referrer), cell: hit.referrer.slice(hit.referrer.indexOf(KEY_SEP) + 1) });
            }
          });
        }
      }

      return {
        hasReference: directCount > 0,
        directCount,
        crossSheetCount,
        crossSheet: crossSheetCount > 0,
        referrers,
        viaRange
      };
    }

    /*
     * Unique downstream nodes reachable from `startKey` via referrer edges.
     * Iterative DFS with colouring: cycle-safe (no stack overflow, no infinite
     * loop) and de-duplicated (a node reachable by many paths counts once).
     * `hasCycle` is true when a back-edge is found on the traversed sub-graph.
     */
    function downstream(startKey) {
      if (budgetExhausted) return { count: null, truncated: true, hasCycle: false };
      const color = new Map(); // 1 = gray (on stack), 2 = black (done)
      const reachable = new Set();
      let hasCycle = false;
      let visited = 0;

      color.set(startKey, 1);
      const stack = [{ node: startKey, iter: null }];

      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.iter === null) {
          const children = adjacency.get(frame.node);
          frame.iter = children ? children.values() : null;
        }
        if (!frame.iter) {
          color.set(frame.node, 2);
          stack.pop();
          continue;
        }
        const next = frame.iter.next();
        if (next.done) {
          color.set(frame.node, 2);
          stack.pop();
          continue;
        }
        const child = next.value;
        const c = color.get(child) || 0;
        if (c === 1) { hasCycle = true; continue; } // back-edge
        if (c === 2) continue;
        if (child !== startKey) reachable.add(child);
        visited += 1;
        downstreamBudgetLeft -= 1;
        if (downstreamBudgetLeft <= 0) { budgetExhausted = true; return { count: reachable.size, truncated: true, hasCycle }; }
        if (reachable.size > downstreamCap) return { count: reachable.size, truncated: true, hasCycle };
        color.set(child, 1);
        stack.push({ node: child, iter: null });
      }

      return { count: reachable.size, truncated: false, hasCycle };
    }

    function stats() {
      let edges = 0;
      adjacency.forEach((set) => { edges += set.size; });
      return {
        formulaCells,
        referenceEdges,
        expandedRangeCells,
        unexpandedRanges,
        trackedCells: adjacency.size,
        graphEdges: edges,
        downstreamBudgetExhausted: budgetExhausted
      };
    }

    return { adjacency, direct: adjacency, largeRanges, lookup, downstream, stats };
  }

  return {
    KEY_SEP,
    columnIndex,
    columnLabel,
    normalizeAddress,
    makeKey,
    keySheet,
    extractReferences,
    collectDefinedNames,
    buildReferenceMap
  };
});
