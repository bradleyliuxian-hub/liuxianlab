'use strict';

/*
 * Liuxian Lab - Excel hardcode check: relative formula pattern.
 *
 * Pure and dependency-free (except the parser). Normalizes a formula into a
 * position-relative signature so sibling formulas can be compared by shape
 * instead of by string, and provides the comparison helpers used by the rules.
 */

(function (root, factory) {
  const parser = (typeof module !== 'undefined' && module.exports)
    ? require('./formula-parser.js')
    : root.HardcodeFormulaParser;

  const api = factory(parser);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HardcodeFormulaPattern = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (parser) {
  function refKey(ref, baseRow, baseCol) {
    const c = ref.col == null ? '*' : (ref.colAbs ? `$${ref.col}` : `${ref.col - baseCol}`);
    const r = ref.row == null ? '*' : (ref.rowAbs ? `$${ref.row}` : `${ref.row - baseRow}`);
    return `R[${c};${r}]`;
  }

  const PLUG_ABS_MAX = 5;

  // Does the tree contain a rounding call at all? A small additive constant is
  // only a "rounding plug" when it is attached to a rounded result.
  function containsRounding(node) {
    if (!node) return false;
    switch (node.t) {
      case 'func': return parser.ROUNDING_FUNCTIONS.has(node.name) || node.args.some(containsRounding);
      case 'bin': return containsRounding(node.left) || containsRounding(node.right);
      case 'un': return containsRounding(node.operand);
      case 'paren': return containsRounding(node.expr);
      case 'array': return node.items.some(containsRounding);
      default: return false;
    }
  }

  function buildPattern(parsed, row, col) {
    if (!parsed || !parsed.ok || !parsed.ast) {
      return { signature: '', sigTokens: [], constants: [], references: [] };
    }
    const baseRow = Number(row);
    const baseCol = Number(col);
    const sigTokens = [];
    const hasRounding = containsRounding(parsed.ast);

    function push(kind, key, extra) {
      sigTokens.push(Object.assign({ kind, key }, extra || {}));
    }

    function walk(node, ctx) {
      if (!node) return;
      switch (node.t) {
        case 'num': {
          const role = parser.classifyNumber(node.value, {
            inArray: ctx.inArray,
            funcName: ctx.funcName,
            argIndex: ctx.argIndex,
            inArithmetic: ctx.inArithmetic,
            mathOp: ctx.mathOp || null
          });
          if (role === 'CONTROL_ARGUMENT' || role === 'UNIT_CONVERSION') {
            push('NC', `C[${node.value}]`, { value: node.value, role });
          } else {
            // A small +/- literal added OUTSIDE the rounding call is a manual
            // rounding plug (HC006) rather than an ordinary business constant.
            const plug = hasRounding && ctx.additive && !ctx.insideRound
              && node.value !== 0 && Math.abs(node.value) <= PLUG_ABS_MAX;
            push('N', 'N', {
              value: node.value,
              percent: Boolean(node.percent),
              role,
              business: role === 'BUSINESS_CONSTANT' || role === 'UNKNOWN_CONSTANT',
              mathOp: ctx.mathOp || null,
              plug
            });
          }
          break;
        }
        case 'str':
          push('S', 'S');
          break;
        case 'bool':
          push('BOOL', `B[${node.value}]`);
          break;
        case 'ref':
          push('REF', refKey(node.ref, baseRow, baseCol), { ref: node.ref });
          break;
        case 'range':
          push('RANGE', `G[${refKey(node.start.ref, baseRow, baseCol)};${refKey(node.end.ref, baseRow, baseCol)}]`);
          break;
        case 'name':
          push('NAME', `M[${node.name}]`);
          break;
        case 'paren':
          push('LP', '(');
          walk(node.expr, ctx);
          push('RP', ')');
          break;
        case 'un':
          if (node.op === '%') {
            walk(node.operand, ctx);
            push('OP', 'OP[%]');
          } else {
            push('OP', `OP[${node.op}]`);
            walk(node.operand, { ...ctx, inArithmetic: true, mathOp: node.op, additive: false });
          }
          break;
        case 'bin': {
          const arithmetic = ['+', '-', '*', '/', '^'].indexOf(node.op) !== -1;
          const additive = node.op === '+' || node.op === '-';
          const child = { ...ctx, inArithmetic: arithmetic || ctx.inArithmetic, mathOp: arithmetic ? node.op : ctx.mathOp, additive };
          walk(node.left, child);
          push('OP', `OP[${node.op}]`);
          walk(node.right, child);
          break;
        }
        case 'array':
          push('ARR', 'ARR');
          break;
        case 'func':
          push('FUNC', `F[${node.name}]`);
          push('LP', '(');
          node.args.forEach((arg, index) => {
            if (index > 0) push('COMMA', ',');
            walk(arg, {
              funcName: node.name,
              argIndex: index,
              inArithmetic: false,
              inArray: ctx.inArray,
              mathOp: null,
              insideRound: ctx.insideRound || parser.ROUNDING_FUNCTIONS.has(node.name),
              additive: false
            });
          });
          push('RP', ')');
          break;
        default:
          break;
      }
    }

    walk(parsed.ast, {
      funcName: null, argIndex: null, inArithmetic: false, inArray: false,
      mathOp: null, insideRound: false, additive: false
    });
    const signature = sigTokens.map((token) => token.key).join(' ');
    return { signature, sigTokens, constants: parsed.constants || [], references: parsed.references || [] };
  }

  function signatureEquals(a, b) {
    return Boolean(a && b && a.signature && a.signature === b.signature);
  }

  function keysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i].key !== b[i].key) return false;
    return true;
  }

  const REFERENCE_KINDS = new Set(['REF', 'RANGE', 'NAME']);

  function isReferenceOperand(token) {
    return Boolean(token) && REFERENCE_KINDS.has(token.kind);
  }

  function isBusinessToken(token) {
    return Boolean(token) && token.kind === 'N' && token.business === true;
  }

  // Neighbor has a reference operand (cell, range, cross-sheet or named range)
  // where the current formula has a hardcode number.
  function referenceReplacedByConstant(neighborTokens, currentTokens) {
    if (!Array.isArray(neighborTokens) || !Array.isArray(currentTokens)) return -1;
    if (neighborTokens.length !== currentTokens.length) return -1;
    let replaced = -1;
    for (let i = 0; i < neighborTokens.length; i += 1) {
      const n = neighborTokens[i];
      const c = currentTokens[i];
      if (isReferenceOperand(n) && isBusinessToken(c)) {
        if (replaced !== -1) return -1;
        replaced = i;
      } else if (n.key !== c.key) {
        return -1;
      }
    }
    return replaced;
  }

  // Current formula = neighbor structure plus extra arithmetic business numbers.
  function extraConstantAdded(neighborTokens, currentTokens) {
    if (!Array.isArray(neighborTokens) || !Array.isArray(currentTokens)) return { added: false, values: [], positions: [] };
    if (currentTokens.length <= neighborTokens.length) return { added: false, values: [], positions: [] };
    let i = 0;
    let j = 0;
    const extras = [];
    while (i < neighborTokens.length && j < currentTokens.length) {
      if (neighborTokens[i].key === currentTokens[j].key) { i += 1; j += 1; }
      else { extras.push({ token: currentTokens[j], index: j }); j += 1; }
    }
    if (i < neighborTokens.length) return { added: false, values: [], positions: [] };
    const rest = currentTokens.slice(j).map((token, k) => ({ token, index: j + k }));
    const all = extras.concat(rest);
    let hasNumber = false;
    let ok = true;
    const values = [];
    const positions = [];
    all.forEach(({ token, index }) => {
      if (token.kind === 'OP' || token.kind === 'NC') return;
      if (token.kind === 'N') {
        const prev = currentTokens[index - 1];
        const sign = prev && prev.kind === 'OP' && prev.key === 'OP[-]' ? -1 : 1;
        hasNumber = true;
        values.push(sign * token.value);
        positions.push(index);
        return;
      }
      ok = false;
    });
    return { added: ok && hasNumber, values, positions };
  }

  function majorityValue(values) {
    const counts = new Map();
    values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let best = null;
    let bestCount = 0;
    counts.forEach((count, value) => { if (count > bestCount) { best = value; bestCount = count; } });
    return { value: best, count: bestCount };
  }

  // Same shape, but one business constant differs from the siblings' majority.
  function differingConstantPosition(neighborTokenLists, currentTokens) {
    if (!Array.isArray(neighborTokenLists) || neighborTokenLists.length < 2) return -1;
    const base = neighborTokenLists[0];
    if (!base || base.length !== currentTokens.length) return -1;
    for (let i = 0; i < currentTokens.length; i += 1) {
      if (base[i].key !== currentTokens[i].key) return -1;
    }
    for (let i = 0; i < currentTokens.length; i += 1) {
      if (!isBusinessToken(currentTokens[i])) continue;
      const values = neighborTokenLists.map((tokens) => tokens[i].value);
      const mode = majorityValue(values);
      if (currentTokens[i].value !== mode.value && mode.count >= 2) return i;
    }
    return -1;
  }

  // True when a sibling formula shares this structure but carries a different
  // business constant at the same position (a varying parameter, not a fixed hardcode).
  function businessConstantMismatch(neighborTokens, currentTokens) {
    if (!Array.isArray(neighborTokens) || !Array.isArray(currentTokens)) return false;
    if (neighborTokens.length !== currentTokens.length) return false;
    for (let i = 0; i < currentTokens.length; i += 1) {
      if (isBusinessToken(neighborTokens[i]) && isBusinessToken(currentTokens[i])
        && neighborTokens[i].value !== currentTokens[i].value) return true;
    }
    return false;
  }

  return {
    buildPattern,
    signatureEquals,
    keysEqual,
    isReferenceOperand,
    isBusinessToken,
    referenceReplacedByConstant,
    extraConstantAdded,
    differingConstantPosition,
    businessConstantMismatch,
    refKey
  };
});
