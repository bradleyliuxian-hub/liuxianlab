'use strict';

/*
 * Liuxian Lab - Excel hardcode check: formula tokenizer + parser.
 *
 * Pure and dependency-free. Turns an Excel formula into tokens and a small
 * AST, then classifies every numeric literal by its syntactic role.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HardcodeFormulaParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ROLE = {
    CONTROL_ARGUMENT: 'CONTROL_ARGUMENT',
    UNIT_CONVERSION: 'UNIT_CONVERSION',
    LOGICAL_CONSTANT: 'LOGICAL_CONSTANT',
    DATE_ARGUMENT: 'DATE_ARGUMENT',
    BUSINESS_CONSTANT: 'BUSINESS_CONSTANT',
    STRING_CONTENT: 'STRING_CONTENT',
    ARRAY_CONSTANT: 'ARRAY_CONSTANT',
    UNKNOWN_CONSTANT: 'UNKNOWN_CONSTANT'
  };

  // Zero-based argument positions that are pure control parameters.
  const CONTROL_ARGS = {
    ROUND: [1], ROUNDUP: [1], ROUNDDOWN: [1], ROUNDBANK: [1], TRUNC: [1], INT: [1],
    LEFT: [1], RIGHT: [1], MID: [1, 2],
    SMALL: [1], LARGE: [1],
    INDEX: [1, 2, 3], MATCH: [2],
    IFERROR: [1], IFNA: [1],
    CHOOSE: [0],
    OFFSET: [1, 2, 3, 4, 5],
    VLOOKUP: [2, 3], HLOOKUP: [2, 3], LOOKUP: [2],
    SEARCH: [2], FIND: [2], SUBSTITUTE: [3], REPLACE: [1, 2, 3],
    REPT: [1],
    TEXT: []
  };

  const DATE_ARGS = {
    DATE: [0, 1, 2], EDATE: [1], EOMONTH: [1],
    YEAR: [0], MONTH: [0], DAY: [0], WEEKNUM: [1],
    DATEVALUE: [0]
  };

  const LOGICAL_VALUES = [-1, 0, 1];

  // Rounding function family. A unit value used multiplicatively inside the
  // value argument (e.g. ROUND(x/1000,0), ROUND(x*1000,2)) is a normal
  // thousand / ten-thousand conversion, not a hardcode.
  const ROUNDING_FUNCTIONS = new Set(['ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ROUNDBANK', 'MROUND']);

  // Common currency / magnitude conversion factors (yuan <-> thousand / 万 / 亿).
  const CONVERSION_VALUES = new Set([1000, 10000, 100000, 1000000, 10000000, 100000000]);

  function isRoundConversion(ctx, value) {
    if (ctx.argIndex !== 0) return false;
    if (!ctx.funcName || !ROUNDING_FUNCTIONS.has(ctx.funcName)) return false;
    if (ctx.mathOp !== '/' && ctx.mathOp !== '*') return false;
    return CONVERSION_VALUES.has(value);
  }

  // CHOOSE: argument 0 is the index, the rest are value branches; every numeric
  // argument is a control/selector, never a business constant.
  const CONTROL_ALL_ARGS = new Set(['CHOOSE']);

  function isControlArg(name, index) {
    if (CONTROL_ALL_ARGS.has(name)) return true;
    const list = CONTROL_ARGS[name];
    return Array.isArray(list) && list.indexOf(index) !== -1;
  }

  function isDateArg(name, index) {
    const list = DATE_ARGS[name];
    return Array.isArray(list) && list.indexOf(index) !== -1;
  }

  // Role of a numeric literal given its syntactic context. Shared with the
  // pattern builder so tokens and rules agree on what counts as a hardcode.
  function classifyNumber(value, ctx) {
    if (ctx.inArray) return ROLE.ARRAY_CONSTANT;
    if (ctx.funcName && isControlArg(ctx.funcName, ctx.argIndex)) return ROLE.CONTROL_ARGUMENT;
    if (ctx.funcName && isDateArg(ctx.funcName, ctx.argIndex)) return ROLE.DATE_ARGUMENT;
    if (isRoundConversion(ctx, value)) return ROLE.UNIT_CONVERSION;
    if (LOGICAL_VALUES.indexOf(value) !== -1) return ROLE.LOGICAL_CONSTANT;
    if (ctx.inArithmetic) return ROLE.BUSINESS_CONSTANT;
    return ROLE.UNKNOWN_CONSTANT;
  }

  function colToIndex(letters) {
    const up = String(letters).toUpperCase();
    let n = 0;
    for (let i = 0; i < up.length; i += 1) n = n * 26 + (up.charCodeAt(i) - 64);
    return n - 1;
  }

  const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/;

  function tokenize(body) {
    const tokens = [];
    const n = body.length;
    let i = 0;

    function readRefAt(pos) {
      const m = REF_RE.exec(body.slice(pos));
      if (!m) return null;
      return {
        col: colToIndex(m[2]), colAbs: m[1] === '$',
        row: Number(m[4]), rowAbs: m[3] === '$',
        next: pos + m[0].length
      };
    }

    // Full-column range such as A:A or $B:$D (row is null).
    function readColRangeAt(pos) {
      const m = /^(\$?)([A-Za-z]{1,3})\s*:\s*(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9])/.exec(body.slice(pos));
      if (!m) return null;
      return {
        start: { col: colToIndex(m[2]), colAbs: m[1] === '$', row: null, rowAbs: false },
        end: { col: colToIndex(m[4]), colAbs: m[3] === '$', row: null, rowAbs: false },
        next: pos + m[0].length
      };
    }

    function emitRef(sheet, ref, start) {
      let end = ref.next;
      if (body[end] === ':') {
        const second = readRefAt(end + 1);
        if (second) {
          tokens.push({
            type: 'range', sheet, raw: body.slice(start, second.next),
            start: { col: ref.col, colAbs: ref.colAbs, row: ref.row, rowAbs: ref.rowAbs },
            end: { col: second.col, colAbs: second.colAbs, row: second.row, rowAbs: second.rowAbs }
          });
          return second.next;
        }
      }
      tokens.push({
        type: 'ref', sheet, raw: body.slice(start, end),
        col: ref.col, colAbs: ref.colAbs, row: ref.row, rowAbs: ref.rowAbs
      });
      return end;
    }

    while (i < n) {
      const ch = body[i];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }

      if (ch === '"') {
        let j = i + 1;
        let value = '';
        while (j < n) {
          if (body[j] === '"') {
            if (body[j + 1] === '"') { value += '"'; j += 2; } else { j += 1; break; }
          } else { value += body[j]; j += 1; }
        }
        tokens.push({ type: 'string', value, raw: body.slice(i, j), pos: i });
        i = j;
        continue;
      }

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(body[i + 1] || ''))) {
        let j = i;
        while (j < n && /[0-9]/.test(body[j])) j += 1;
        if (body[j] === '.') { j += 1; while (j < n && /[0-9]/.test(body[j])) j += 1; }
        if (body[j] === 'e' || body[j] === 'E') {
          let k = j + 1;
          if (body[k] === '+' || body[k] === '-') k += 1;
          if (/[0-9]/.test(body[k] || '')) { j = k; while (j < n && /[0-9]/.test(body[j])) j += 1; }
        }
        const numeric = body.slice(i, j);
        let percent = false;
        let end = j;
        if (body[end] === '%') { percent = true; end += 1; }
        tokens.push({ type: 'number', value: Number(numeric), percent, raw: body.slice(i, end), pos: i });
        i = end;
        continue;
      }

      if (ch === "'") {
        let j = i + 1;
        let name = '';
        while (j < n) {
          if (body[j] === "'") {
            if (body[j + 1] === "'") { name += "'"; j += 2; } else { j += 1; break; }
          } else { name += body[j]; j += 1; }
        }
        if (body[j] === '!') {
          const ref = readRefAt(j + 1);
          if (ref) { i = emitRef(name, ref, i); continue; }
        }
        tokens.push({ type: 'name', value: name, raw: body.slice(i, j), pos: i });
        i = j;
        continue;
      }

      if (/[A-Za-z_$]/.test(ch)) {
        const colRange = readColRangeAt(i);
        if (colRange) {
          tokens.push({ type: 'range', sheet: null, raw: body.slice(i, colRange.next), start: colRange.start, end: colRange.end });
          i = colRange.next;
          continue;
        }
        const ref = readRefAt(i);
        if (ref && body[ref.next] !== '(') { i = emitRef(null, ref, i); continue; }

        let j = i;
        if (body[j] === '$') j += 1;
        while (j < n && /[A-Za-z0-9_.]/.test(body[j])) j += 1;
        const word = body.slice(i, j);

        if (body[j] === '!') {
          const colRange2 = readColRangeAt(j + 1);
          if (colRange2) {
            tokens.push({ type: 'range', sheet: word, raw: body.slice(i, colRange2.next), start: colRange2.start, end: colRange2.end });
            i = colRange2.next;
            continue;
          }
          const ref2 = readRefAt(j + 1);
          if (ref2) { i = emitRef(word, ref2, i); continue; }
          tokens.push({ type: 'name', value: word, raw: word, pos: i });
          i = j;
          continue;
        }
        if (body[j] === '(') {
          tokens.push({ type: 'func', value: word.toUpperCase(), raw: word, pos: i });
          i = j;
          continue;
        }
        if (/^(TRUE|FALSE)$/i.test(word)) {
          tokens.push({ type: 'bool', value: /^true$/i.test(word), raw: word, pos: i });
          i = j;
          continue;
        }
        tokens.push({ type: 'name', value: word, raw: word, pos: i });
        i = j;
        continue;
      }

      const two = body.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ type: 'op', value: two, raw: two, pos: i });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>%'.indexOf(ch) !== -1) {
        tokens.push({ type: 'op', value: ch, raw: ch, pos: i });
        i += 1;
        continue;
      }
      if (ch === '(') { tokens.push({ type: 'lparen', raw: ch, pos: i }); i += 1; continue; }
      if (ch === ')') { tokens.push({ type: 'rparen', raw: ch, pos: i }); i += 1; continue; }
      if (ch === '{') { tokens.push({ type: 'lbrace', raw: ch, pos: i }); i += 1; continue; }
      if (ch === '}') { tokens.push({ type: 'rbrace', raw: ch, pos: i }); i += 1; continue; }
      if (ch === ',' || ch === ';') { tokens.push({ type: 'comma', raw: ch, pos: i }); i += 1; continue; }

      tokens.push({ type: 'unknown', raw: ch, pos: i });
      i += 1;
    }

    return tokens;
  }

  function parseTokens(tokens) {
    let pos = 0;
    let ok = true;

    const peek = () => tokens[pos];
    const isOp = (value) => { const t = tokens[pos]; return t && t.type === 'op' && t.value === value; };

    function parseExpr() { return parseCompare(); }

    function parseBinary(sub, ops) {
      let left = sub();
      while (tokens[pos] && tokens[pos].type === 'op' && ops.indexOf(tokens[pos].value) !== -1) {
        const op = tokens[pos].value;
        pos += 1;
        const right = sub();
        left = { t: 'bin', op, left, right };
      }
      return left;
    }

    const parseCompare = () => parseBinary(parseConcat, ['=', '<>', '<', '<=', '>', '>=']);
    const parseConcat = () => parseBinary(parseAddSub, ['&']);
    const parseAddSub = () => parseBinary(parseMulDiv, ['+', '-']);
    const parseMulDiv = () => parseBinary(parsePower, ['*', '/']);
    const parsePower = () => parseBinary(parseUnary, ['^']);

    function parseUnary() {
      const t = tokens[pos];
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        pos += 1;
        return { t: 'un', op: t.value, operand: parseUnary() };
      }
      return parsePostfix();
    }

    function parsePostfix() {
      let node = parsePrimary();
      while (tokens[pos] && tokens[pos].type === 'op' && tokens[pos].value === '%') {
        pos += 1;
        node = { t: 'un', op: '%', operand: node };
      }
      return node;
    }

    function parseArgs() {
      const args = [];
      if (tokens[pos] && tokens[pos].type === 'rparen') { pos += 1; return args; }
      args.push(parseExpr());
      while (tokens[pos] && tokens[pos].type === 'comma') {
        pos += 1;
        if (tokens[pos] && tokens[pos].type === 'rparen') break;
        args.push(parseExpr());
      }
      if (tokens[pos] && tokens[pos].type === 'rparen') pos += 1;
      else ok = false;
      return args;
    }

    function parseArray() {
      const items = [];
      pos += 1; // {
      let depth = 1;
      const start = pos;
      while (tokens[pos]) {
        if (tokens[pos].type === 'lbrace') depth += 1;
        if (tokens[pos].type === 'rbrace') {
          depth -= 1;
          if (depth === 0) { pos += 1; break; }
        }
        pos += 1;
      }
      const inner = tokens.slice(start, Math.max(start, pos - 1));
      inner.forEach((token) => {
        if (token.type === 'number') items.push({ t: 'num', value: token.value, percent: token.percent });
        if (token.type === 'string') items.push({ t: 'str', value: token.value });
      });
      return { t: 'array', items };
    }

    function parsePrimary() {
      const token = tokens[pos];
      if (!token) { ok = false; return null; }
      switch (token.type) {
        case 'number':
          pos += 1;
          return { t: 'num', value: token.value, percent: token.percent };
        case 'string':
          pos += 1;
          return { t: 'str', value: token.value };
        case 'bool':
          pos += 1;
          return { t: 'bool', value: token.value };
        case 'ref':
          pos += 1;
          return { t: 'ref', ref: token };
        case 'range':
          pos += 1;
          return {
            t: 'range',
            start: { t: 'ref', ref: { ...token.start } },
            end: { t: 'ref', ref: { ...token.end } }
          };
        case 'name':
          pos += 1;
          return { t: 'name', name: token.value };
        case 'func': {
          const name = token.value;
          pos += 1;
          if (!tokens[pos] || tokens[pos].type !== 'lparen') { ok = false; return null; }
          pos += 1;
          const args = parseArgs();
          return { t: 'func', name, args };
        }
        case 'lparen': {
          pos += 1;
          const inner = parseExpr();
          if (tokens[pos] && tokens[pos].type === 'rparen') pos += 1; else ok = false;
          return { t: 'paren', expr: inner };
        }
        case 'lbrace':
          return parseArray();
        case 'op':
          if (token.value === '+' || token.value === '-') return parseUnary();
          ok = false;
          pos += 1;
          return null;
        default:
          ok = false;
          pos += 1;
          return null;
      }
    }

    const ast = parseExpr();
    if (pos < tokens.length) ok = false;
    return { ast, ok };
  }

  function classify(ast) {
    const constants = [];
    const references = [];
    const functions = [];
    const result = { constants, references, functions, hasArrayConstant: false, hasString: false, hasNamedRange: false };

    function walk(node, ctx) {
      if (!node) return;
      switch (node.t) {
        case 'num': {
          const role = classifyNumber(node.value, ctx);
          constants.push({
            value: node.value,
            percent: Boolean(node.percent),
            role,
            mathOp: ctx.mathOp || null,
            func: ctx.funcName || null,
            argIndex: ctx.argIndex == null ? null : ctx.argIndex
          });
          break;
        }
        case 'str': {
          result.hasString = true;
          const re = /\d+(?:\.\d+)?/g;
          let m = re.exec(node.value);
          while (m) {
            constants.push({
              value: Number(m[0]), percent: false, role: ROLE.STRING_CONTENT,
              func: null, argIndex: null, inString: true
            });
            m = re.exec(node.value);
          }
          break;
        }
        case 'ref':
          references.push(node.ref);
          break;
        case 'range':
          references.push(node.start.ref, node.end.ref);
          break;
        case 'func':
          functions.push(node.name);
          node.args.forEach((arg, index) => {
            walk(arg, { funcName: node.name, argIndex: index, inArithmetic: false, inArray: ctx.inArray, mathOp: null });
          });
          break;
        case 'bin': {
          const arithmetic = ['+', '-', '*', '/', '^'].indexOf(node.op) !== -1;
          const childCtx = { ...ctx, inArithmetic: arithmetic || ctx.inArithmetic, mathOp: arithmetic ? node.op : ctx.mathOp };
          walk(node.left, childCtx);
          walk(node.right, childCtx);
          break;
        }
        case 'un':
          walk(node.operand, { ...ctx, inArithmetic: node.op !== '%' ? true : ctx.inArithmetic });
          break;
        case 'paren':
          walk(node.expr, ctx);
          break;
        case 'array':
          result.hasArrayConstant = true;
          node.items.forEach((item) => walk(item, { ...ctx, inArray: true }));
          break;
        case 'name':
          result.hasNamedRange = true;
          break;
        default:
          break;
      }
    }

    walk(ast, { funcName: null, argIndex: null, inArithmetic: false, inArray: false });
    return result;
  }

  function parse(formula) {
    const raw = String(formula == null ? '' : formula).trim();
    const body = raw.replace(/^=/, '');
    if (!body) {
      return {
        raw, body, tokens: [], ast: null, ok: false,
        constants: [], references: [], functions: [],
        hasArrayConstant: false, hasString: false, hasNamedRange: false
      };
    }
    const tokens = tokenize(body);
    const { ast, ok } = parseTokens(tokens);
    const info = ast && ok
      ? classify(ast)
      : { constants: [], references: [], functions: [], hasArrayConstant: false, hasString: false, hasNamedRange: false };
    return {
      raw, body, tokens, ast, ok,
      constants: info.constants,
      references: info.references,
      functions: info.functions,
      hasArrayConstant: info.hasArrayConstant,
      hasString: info.hasString,
      hasNamedRange: info.hasNamedRange
    };
  }

  return {
    parse, tokenize, colToIndex, ROLE, CONTROL_ARGS, DATE_ARGS,
    ROUNDING_FUNCTIONS, CONVERSION_VALUES,
    isControlArg, isDateArg, classifyNumber
  };
});
