'use strict';

/*
 * Liuxian Lab — Excel 尾差风险检查: workbook scan + issue export (read-only).
 *
 * XLSX-engine agnostic: the SheetJS namespace is always passed in as the first
 * argument, so this module runs unchanged in the browser and in Node.
 *
 * Business-type classification runs BEFORE decimal classification, and an
 * exchange rate propagates along *pure reference* chains (a formula that is
 * exactly one cell/name reference inherits the rate type). Any real computation
 * on a rate becomes `exchange_rate_derived` (no free 4-decimal allowance).
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const core = isNode ? require('./decimal-core.js') : root.DecimalCheckCore;
  const referenceMap = isNode ? require('./reference-map.js') : root.DecimalReferenceMap;
  const riskCore = isNode ? require('./risk-core.js') : root.DecimalRiskCore;
  const businessType = isNode ? require('./business-type.js') : root.DecimalBusinessType;

  const api = factory(core, referenceMap, riskCore, businessType);
  if (isNode) {
    module.exports = api;
  } else {
    root.DecimalWorkbook = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, referenceMap, riskCore, businessType) {
  const CATEGORY = riskCore.CATEGORY;
  const BT = businessType.BUSINESS_TYPE;
  const LABEL_SCAN_LIMIT = 60;

  function readOptions(extra) {
    return Object.assign({
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
      sheetStubs: true,
      bookVBA: true
    }, extra || {});
  }

  function cellIsNumericDate(XLSX, cell) {
    return cell.t === 'n' && cell.z && typeof XLSX.SSF.is_date === 'function' && XLSX.SSF.is_date(cell.z);
  }

  function isBlankStub(cell) {
    if (cell.f) return false;
    return cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '';
  }

  function formatDecimals(places) {
    return places === null || places === undefined ? '>15' : places;
  }

  function safeFormatValue(XLSX, cell) {
    if (typeof cell.v !== 'number') return '';
    if (!cell.z) return '';
    try {
      if (typeof XLSX.SSF.format === 'function') return XLSX.SSF.format(cell.z, cell.v);
    } catch (_) { /* fall through */ }
    return '';
  }

  function buildHiddenMeta(wb) {
    const sheetHidden = {};
    const wbSheets = wb.Workbook && wb.Workbook.Sheets;
    if (Array.isArray(wbSheets)) {
      wbSheets.forEach((entry) => {
        if (entry && entry.name) sheetHidden[entry.name] = Number(entry.Hidden || 0);
      });
    }
    const rows = {};
    const cols = {};
    (wb.SheetNames || []).forEach((name) => {
      const ws = wb.Sheets[name];
      if (!ws) return;
      const rowSet = new Set();
      if (Array.isArray(ws['!rows'])) ws['!rows'].forEach((info, i) => { if (info && info.hidden) rowSet.add(i); });
      const colSet = new Set();
      if (Array.isArray(ws['!cols'])) ws['!cols'].forEach((info, i) => { if (info && info.hidden) colSet.add(i); });
      rows[name] = rowSet;
      cols[name] = colSet;
    });
    return { sheetHidden, rows, cols };
  }

  function cellVisibility(hiddenMeta, sheetName, row, col) {
    if ((hiddenMeta.sheetHidden[sheetName] || 0) !== 0) return false;
    const rowSet = hiddenMeta.rows[sheetName];
    if (rowSet && rowSet.has(row)) return false;
    const colSet = hiddenMeta.cols[sheetName];
    if (colSet && colSet.has(col)) return false;
    return true;
  }

  /*
   * Nearest non-empty cell to the left / above, stopping at the first non-empty
   * cell; returns its text only when that neighbour IS text (a numeric neighbour
   * blocks it, so a title far away never leaks onto an unrelated value).
   */
  function scanTitle(ws, row, col, direction) {
    if (!ws) return null;
    const dr = direction === 'left' ? 0 : -1;
    const dc = direction === 'left' ? -1 : 0;
    let r = row;
    let c = col;
    for (let n = 0; n < LABEL_SCAN_LIMIT; n += 1) {
      r += dr;
      c += dc;
      if (r < 0 || c < 0) return null;
      const cell = ws[referenceMap.normalizeAddress(r, c)];
      if (!cell) continue;
      if (cell.t === 'z') continue;
      if (cell.v === undefined || cell.v === null || cell.v === '') {
        if (cell.f) return null;
        continue;
      }
      return typeof cell.v === 'string' ? cell.v : null;
    }
    return null;
  }

  // workbook.Workbook.Names -> { byCell: Map(key->[names]), singleCellByName: Map(NAME->key) }
  function buildNameIndex(wb) {
    const byCell = new Map();
    const singleCellByName = new Map();
    const names = wb.Workbook && wb.Workbook.Names;
    if (!Array.isArray(names)) return { byCell, singleCellByName };
    names.forEach((entry) => {
      if (!entry || !entry.Name) return;
      const ref = String(entry.Ref || '');
      if (!ref || ref.charAt(0) === '=') return;
      const bang = ref.indexOf('!');
      if (bang === -1) return;
      let sheet = ref.slice(0, bang);
      if (sheet.charAt(0) === "'" && sheet.charAt(sheet.length - 1) === "'") {
        sheet = sheet.slice(1, -1).replace(/''/g, "'");
      }
      const parts = ref.slice(bang + 1).split(':');
      const a = core.parseCellAddress(parts[0]);
      if (!a) return;
      const b = parts[1] ? core.parseCellAddress(parts[1]) : a;
      if (!b) return;
      if (!parts[1]) singleCellByName.set(String(entry.Name).toUpperCase(), referenceMap.makeKey(sheet, referenceMap.normalizeAddress(a.row, a.col)));
      const r0 = Math.min(a.row, b.row);
      const r1 = Math.max(a.row, b.row);
      const c0 = Math.min(a.col, b.col);
      const c1 = Math.max(a.col, b.col);
      if ((r1 - r0 + 1) * (c1 - c0 + 1) > 500) return;
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
          const key = referenceMap.makeKey(sheet, referenceMap.normalizeAddress(r, c));
          let list = byCell.get(key);
          if (!list) { list = []; byCell.set(key, list); }
          list.push(entry.Name);
        }
      }
    });
    return { byCell, singleCellByName };
  }

  function detectBusinessType(wb, nameIndex, ws, sheetName, row, col, pureTarget) {
    const labels = [];
    const left = scanTitle(ws, row, col, 'left');
    if (left) labels.push({ value: left, source: '同行/邻近' });
    const above = scanTitle(ws, row, col, 'up');
    if (above) labels.push({ value: above, source: '同列' });
    const names = nameIndex.get(referenceMap.makeKey(sheetName, referenceMap.normalizeAddress(row, col))) || [];

    const own = businessType.classify({ labels, names, referencedLabels: [] });
    if (own.businessType !== BT.NORMAL_NUMBER) return own;

    // Only a *pure* reference may inherit a rate from the referenced title.
    if (pureTarget) {
      const targetWs = wb.Sheets[pureTarget.sheet];
      if (targetWs) {
        const t = core.parseCellAddress(pureTarget.address);
        if (t) {
          const text = scanTitle(targetWs, t.row, t.col, 'left') || scanTitle(targetWs, t.row, t.col, 'up');
          if (text) {
            const ref = businessType.classify({ labels: [], names: [], referencedLabels: [{ value: text, source: '引用来源' }] });
            if (ref.businessType !== BT.NORMAL_NUMBER) return ref;
          }
        }
      }
    }
    return own;
  }

  function scanWorkbook(XLSX, wb, options) {
    const opts = options || {};
    const includeVisible = opts.includeVisible !== false;
    const includeHidden = Boolean(opts.includeHidden);
    const analyzeReferences = opts.analyzeReferences !== false;

    const hiddenMeta = buildHiddenMeta(wb);
    const { byCell: nameIndex, singleCellByName } = buildNameIndex(wb);
    const refMap = analyzeReferences ? referenceMap.buildReferenceMap(wb) : null;

    function refFacts(sheetName, upperKey) {
      const refInfo = refMap ? refMap.lookup(sheetName, upperKey) : { hasReference: false, directCount: 0, crossSheet: false, referrers: [] };
      const downstreamInfo = refMap ? refMap.downstream(referenceMap.makeKey(sheetName, upperKey)) : { count: 0, truncated: false, hasCycle: false };
      const directReferenceCount = refInfo.directCount || 0;
      const downstreamReferenceCount = downstreamInfo.count == null ? directReferenceCount : downstreamInfo.count;
      const referrersVisible = (refInfo.referrers || []).some((ref) => {
        const p = core.parseCellAddress(ref.cell);
        return p ? cellVisibility(hiddenMeta, ref.sheet, p.row, p.col) : false;
      });
      return { refInfo, downstreamInfo, directReferenceCount, downstreamReferenceCount, referrersVisible };
    }

    // ---- Pass A: collect candidate cells + base business type -------------
    const records = [];
    const sheetOrder = [];
    const scannedBySheet = {};
    let scannedCells = 0;

    (wb.SheetNames || []).forEach((name) => {
      const ws = wb.Sheets[name];
      sheetOrder.push(name);
      let sheetScanned = 0;
      if (ws) {
        Object.keys(ws).forEach((key) => {
          if (key.charAt(0) === '!') return;
          const cell = ws[key];
          if (!cell || isBlankStub(cell)) return;

          const pos = core.parseCellAddress(key);
          const row = pos ? pos.row : -1;
          const col = pos ? pos.col : -1;
          const sheetHiddenValue = hiddenMeta.sheetHidden[name] || 0;
          const rowHidden = row >= 0 && hiddenMeta.rows[name] && hiddenMeta.rows[name].has(row);
          const colHidden = col >= 0 && hiddenMeta.cols[name] && hiddenMeta.cols[name].has(col);
          const hidden = sheetHiddenValue !== 0 || Boolean(rowHidden) || Boolean(colHidden);
          const hiddenType = riskCore.hiddenTypeFor(Boolean(rowHidden), Boolean(colHidden), sheetHiddenValue !== 0, sheetHiddenValue === 2);
          const visible = !hidden;

          if (visible && !includeVisible) return;
          if (hidden && !includeHidden) return;
          sheetScanned += 1;

          const isFormula = Boolean(cell.f);
          const hasNumeric = cell.t === 'n' && typeof cell.v === 'number';
          const isDate = hasNumeric && cellIsNumericDate(XLSX, cell);
          const percentage = hasNumeric && !isDate && riskCore.isPercentageFormat(cell.z);
          const hasCached = !(cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '');

          const candidate = (hasNumeric && !isDate) || (isFormula && !hasCached);
          if (!candidate) return;

          const upperKey = String(key).toUpperCase();
          const decimals = hasNumeric ? core.effectiveDecimalPlaces(cell.v) : null;

          let pureTarget = null;
          if (isFormula && cell.f) {
            const pr = businessType.pureReference(cell.f);
            if (pr && pr.kind === 'cell') {
              pureTarget = { sheet: pr.sheet == null ? name : pr.sheet, address: pr.address };
            } else if (pr && pr.kind === 'name') {
              const targetKey = singleCellByName.get(pr.name.toUpperCase());
              if (targetKey) {
                const bang = targetKey.indexOf('!');
                pureTarget = { sheet: targetKey.slice(0, bang), address: targetKey.slice(bang + 1) };
              }
            }
          }

          let detected = { businessType: BT.NORMAL_NUMBER, confidence: 'high', reason: '' };
          if (hasNumeric && !percentage) {
            detected = detectBusinessType(wb, nameIndex, ws, name, row, col, pureTarget);
          }

          records.push({
            name, key, upperKey, graphKey: referenceMap.makeKey(name, upperKey), row, col, hidden, hiddenType, visible,
            isFormula, hasNumeric, isDate, percentage, hasCached, decimals,
            displayValue: hasNumeric ? safeFormatValue(XLSX, cell) : '',
            numberFormat: cell.z || '',
            formula: cell.f || '',
            pureTarget, detected,
            facts: refFacts(name, upperKey),
            value: hasNumeric ? cell.v : null
          });
        });
      }
      scannedCells += sheetScanned;
      scannedBySheet[name] = sheetScanned;
    });

    // ---- Pass B: propagate exchange-rate along pure-reference chains -------
    const typeInfo = new Map(); // key -> { businessType, sourceKey, depth, passthrough }
    function setType(key, info) {
      const cur = typeInfo.get(key);
      if (cur && cur.businessType === info.businessType && cur.sourceKey === info.sourceKey && cur.depth === info.depth && cur.passthrough === info.passthrough) return false;
      typeInfo.set(key, info);
      return true;
    }

    records.forEach((r) => {
      if (!r.isFormula && r.detected.businessType === BT.EXCHANGE_RATE) {
        setType(r.graphKey, { businessType: BT.EXCHANGE_RATE, sourceKey: r.graphKey, depth: 0, passthrough: false });
      }
    });

    let changed = true;
    let guard = 0;
    while (changed && guard <= records.length + 5) {
      guard += 1;
      changed = false;
      records.forEach((r) => {
        if (!r.isFormula) return;
        const cur = typeInfo.get(r.graphKey);

        // Pure reference inherits the target's type.
        if (r.pureTarget) {
          const p = typeInfo.get(referenceMap.makeKey(r.pureTarget.sheet, r.pureTarget.address));
          if (p) {
            const inherited = p.businessType === BT.EXCHANGE_RATE ? BT.EXCHANGE_RATE : BT.EXCHANGE_RATE_DERIVED;
            if (setType(r.graphKey, { businessType: inherited, sourceKey: p.sourceKey, depth: (p.depth || 0) + 1, passthrough: true })) changed = true;
            return;
          }
        }

        // Any real computation consuming a rate becomes derived.
        if (cur && cur.businessType === BT.EXCHANGE_RATE) return;
        const refs = r.formula ? referenceMap.extractReferences(r.formula, r.name) : [];
        for (let i = 0; i < refs.length; i += 1) {
          const tkey = referenceMap.makeKey(refs[i].sheet == null ? r.name : refs[i].sheet, refs[i].address);
          const t = typeInfo.get(tkey);
          if (t && (t.businessType === BT.EXCHANGE_RATE || t.businessType === BT.EXCHANGE_RATE_DERIVED)) {
            const sourceKey = t.sourceKey || tkey;
            if (setType(r.graphKey, { businessType: BT.EXCHANGE_RATE_DERIVED, sourceKey, depth: (t.depth || 0) + 1, passthrough: false })) changed = true;
            break;
          }
        }
      });
    }

    // Resolve the final business type for each record.
    records.forEach((r) => {
      const lineage = typeInfo.get(r.graphKey) || null;
      let finalType = r.detected.businessType;
      if (finalType !== BT.EXCHANGE_RATE && lineage) finalType = lineage.businessType;
      r.finalType = finalType;
      r.lineage = lineage;
    });

    // ---- Pass C: classify + emit issues / rate rows -----------------------
    const issues = [];
    const rates = [];
    const issuesBySheet = {};
    sheetOrder.forEach((n) => { issuesBySheet[n] = 0; });

    function makeIssue(p) {
      const { category, r, risk, business, value, decimals } = p;
      return {
        type: category,
        typeLabel: riskCore.CATEGORY_LABEL[category],
        category,
        categoryLabel: riskCore.CATEGORY_LABEL[category],
        riskLevel: risk.level,
        riskLabel: riskCore.RISK_LABEL[risk.level],
        riskReason: risk.reason,
        suggestion: riskCore.suggestionFor(category, { visible: r.visible, directReferenceCount: r.facts.directReferenceCount, suspected: business.businessType === BT.SUSPECTED_EXCHANGE_RATE }),
        sheetName: r.name,
        cell: r.key,
        row: r.row,
        col: r.col,
        goto: core.buildExcelGotoReference(r.name, r.key),
        hiddenType: r.hiddenType,
        hiddenLabel: riskCore.HIDDEN_LABEL[r.hiddenType] || r.hiddenType,
        isHidden: r.hidden,
        visible: r.visible,
        isPercentage: Boolean(r.percentage),
        isFormula: r.isFormula,
        originalValue: value,
        decimals,
        displayValue: r.displayValue,
        originalFormula: r.formula,
        numberFormat: r.numberFormat,
        businessType: business.businessType,
        businessTypeLabel: business.typeLabel || businessType.BUSINESS_TYPE_LABEL[business.businessType],
        businessTypeConfidence: business.confidence || 'high',
        businessTypeReason: business.reason || '',
        allowedDecimals: business.allowedDecimals,
        precisionStatus: business.precisionStatus || '',
        exchangeRateSource: business.sourceGoto || '',
        exchangeRatePassthrough: Boolean(business.passthrough),
        exchangeRatePassthroughDepth: business.depth == null ? 0 : business.depth,
        hasReference: Boolean(r.facts.refInfo.hasReference),
        directReferenceCount: r.facts.directReferenceCount,
        downstreamReferenceCount: r.facts.downstreamReferenceCount,
        hasCircularDependency: Boolean(r.facts.downstreamInfo.hasCycle),
        downstreamTruncated: Boolean(r.facts.downstreamInfo.truncated),
        crossSheet: Boolean(r.facts.refInfo.crossSheet),
        isReferenceTerminal: r.visible && r.facts.directReferenceCount === 0,
        referenceScope: 'direct+downstream'
      };
    }

    function pushIssue(category, r, risk, business, value, decimals) {
      issues.push(makeIssue({ category, r, risk, business, value, decimals }));
      issuesBySheet[r.name] = (issuesBySheet[r.name] || 0) + 1;
    }

    function genericRisk(category, r, derivedFromRate) {
      return riskCore.computeRisk({
        category,
        visible: r.visible,
        isFormula: r.isFormula,
        directReferenceCount: r.facts.directReferenceCount,
        downstreamReferenceCount: r.facts.downstreamReferenceCount,
        referrersVisible: r.facts.referrersVisible,
        hasCircularDependency: r.facts.downstreamInfo.hasCycle,
        derivedFromRate
      });
    }

    records.forEach((r) => {
      // Unknown formula result -> never guessed.
      if (!r.hasCached) {
        const category = (r.hidden && includeHidden) ? CATEGORY.HIDDEN : CATEGORY.UNKNOWN;
        pushIssue(category, r, genericRisk(category, r, false),
          { businessType: BT.NORMAL_NUMBER, allowedDecimals: 2 }, null, null);
        return;
      }

      if (r.percentage) {
        const category = (r.hidden && includeHidden) ? CATEGORY.HIDDEN : CATEGORY.PERCENTAGE;
        pushIssue(category, r, genericRisk(category, r, false),
          { businessType: BT.PERCENTAGE, allowedDecimals: null }, r.value, r.decimals);
        return;
      }

      const type = r.finalType;
      const lineage = r.lineage;

      if (businessType.isExchangeLike(type) || type === BT.EXCHANGE_RATE_DERIVED) {
        const suspected = type === BT.SUSPECTED_EXCHANGE_RATE;
        const derivedNotRate = type === BT.EXCHANGE_RATE_DERIVED;
        const allowed = (type === BT.EXCHANGE_RATE) ? 4 : 2;
        const precisionAbnormal = r.decimals === null || r.decimals > allowed;
        const precisionStatus = r.decimals === null ? '不可判定' : (precisionAbnormal ? `超出${allowed}位` : '正常');

        let typeLabel;
        if (suspected) typeLabel = '疑似汇率';
        else if (lineage && lineage.businessType === BT.EXCHANGE_RATE_DERIVED) typeLabel = '汇率派生计算';
        else if (lineage && lineage.passthrough) typeLabel = '汇率直接引用';
        else typeLabel = '原始汇率';

        const sourceKey = lineage ? lineage.sourceKey : r.graphKey;
        const bang = sourceKey.indexOf('!');
        const sourceGoto = bang === -1 ? '' : core.buildExcelGotoReference(sourceKey.slice(0, bang), sourceKey.slice(bang + 1));
        const depth = lineage ? lineage.depth : 0;
        const reason = r.detected.reason || (lineage && lineage.passthrough ? '由上游汇率纯引用继承' : '由已识别汇率计算产生');
        const impact = precisionAbnormal
          ? (suspected ? '疑似汇率，请人工确认业务类型' : (derivedNotRate ? '汇率派生结果存在尾差' : '汇率精度问题'))
          : (r.facts.downstreamReferenceCount >= 3 ? '高影响基础参数' : '正常');

        rates.push({
          sheetName: r.name, cell: r.key, row: r.row, col: r.col,
          goto: core.buildExcelGotoReference(r.name, r.key), originalValue: r.value,
          formula: r.formula, businessType: type, typeLabel, confidence: r.detected.confidence || 'high',
          sourceGoto, depth, allowedDecimals: allowed,
          decimals: r.decimals, precisionStatus,
          directReferenceCount: r.facts.directReferenceCount,
          downstreamReferenceCount: r.facts.downstreamReferenceCount,
          impact, reason
        });

        if (!precisionAbnormal) return;

        const business = { businessType: type, typeLabel, confidence: r.detected.confidence || 'high', reason, allowedDecimals: allowed, precisionStatus, sourceGoto, depth, passthrough: lineage ? lineage.passthrough : false };
        if (type === BT.EXCHANGE_RATE && r.hidden && includeHidden) {
          pushIssue(CATEGORY.HIDDEN, r, genericRisk(CATEGORY.HIDDEN, r, false), business, r.value, r.decimals);
        } else if (suspected) {
          pushIssue(CATEGORY.EXCHANGE_RATE, r, riskCore.computeExchangeRateRisk({ suspected: true, decimals: r.decimals, directReferenceCount: r.facts.directReferenceCount, downstreamReferenceCount: r.facts.downstreamReferenceCount }), business, r.value, r.decimals);
        } else if (derivedNotRate) {
          // derived result -> normal formula rules (no 4-decimal exemption)
          const category = (r.hidden && includeHidden) ? CATEGORY.HIDDEN : CATEGORY.FORMULA;
          pushIssue(category, r, genericRisk(category, r, true), business, r.value, r.decimals);
        } else {
          pushIssue(CATEGORY.EXCHANGE_RATE, r, riskCore.computeExchangeRateRisk({ suspected: false, decimals: r.decimals, directReferenceCount: r.facts.directReferenceCount, downstreamReferenceCount: r.facts.downstreamReferenceCount }), business, r.value, r.decimals);
        }
        return;
      }

      // Normal number / formula.
      const overTwo = r.decimals === null || r.decimals > 2;
      if (!overTwo) return;
      const baseCategory = r.isFormula ? CATEGORY.FORMULA : CATEGORY.RAW;
      const category = (r.hidden && includeHidden) ? CATEGORY.HIDDEN : baseCategory;
      pushIssue(category, r, genericRisk(category, r, false),
        { businessType: BT.NORMAL_NUMBER, allowedDecimals: 2 }, r.value, r.decimals);
    });

    const sheetStats = sheetOrder.map((name) => ({ name, scanned: scannedBySheet[name] || 0, issues: issuesBySheet[name] || 0 }));

    const countBy = (fn) => issues.filter(fn).length;
    const summary = {
      sheetCount: sheetOrder.length,
      scannedCells,
      highRiskCount: countBy((i) => i.riskLevel === riskCore.RISK.HIGH),
      rawCount: countBy((i) => i.category === CATEGORY.RAW),
      formulaCount: countBy((i) => i.category === CATEGORY.FORMULA),
      hiddenCount: countBy((i) => i.category === CATEGORY.HIDDEN),
      percentageCount: countBy((i) => i.category === CATEGORY.PERCENTAGE),
      unknownCount: countBy((i) => i.category === CATEGORY.UNKNOWN),
      exchangeRateCount: countBy((i) => i.category === CATEGORY.EXCHANGE_RATE),
      rateRowCount: rates.length,
      suspectedRateCount: rates.filter((x) => x.typeLabel === '疑似汇率').length,
      derivedRateCount: rates.filter((x) => x.typeLabel === '汇率派生计算').length,
      issueCount: issues.length
    };

    return { issues, rates, sheetStats, summary, referenceStats: refMap ? refMap.stats() : null };
  }

  function sortForExport(issues) {
    return riskCore.sortIssues(issues, 'risk');
  }

  const UNKNOWN_NOTE = '当前 Excel 文件未保存可读取的公式计算结果，请在 Excel / WPS 中重新计算并保存后再次检查。';

  function aoaToSheet(XLSX, aoa, widths) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = (widths || aoa[0] || []).map((wch) => ({ wch }));
    if (aoa.length > 1) {
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } })
      };
    }
    Object.keys(ws).forEach((key) => {
      if (key.charAt(0) === '!') return;
      const cell = ws[key];
      if (cell && typeof cell.v === 'string') { cell.t = 's'; delete cell.f; delete cell.F; }
    });
    return ws;
  }

  function buildHighRiskAoa(issues) {
    const header = [
      '序号', '工作表', '单元格', 'F5定位地址', '问题类型', '当前值', '公式',
      '有效小数位', '是否被引用', '直接引用次数', '下游引用次数', '是否引用终点',
      '隐藏类型', '是否百分比', '风险原因', '人工处理建议'
    ];
    const rows = issues.map((issue, index) => [
      index + 1, issue.sheetName, issue.cell, issue.goto, issue.categoryLabel,
      issue.originalValue === null ? '' : issue.originalValue, issue.originalFormula || '',
      formatDecimals(issue.decimals), riskCore.yesNo(issue.hasReference),
      issue.directReferenceCount, issue.downstreamReferenceCount, riskCore.yesNo(issue.isReferenceTerminal),
      issue.hiddenLabel, riskCore.yesNo(issue.isPercentage), issue.riskReason, issue.suggestion
    ]);
    return [header].concat(rows);
  }

  function buildRawAoa(issues) {
    const header = [
      '序号', '风险等级', '工作表', '单元格', 'F5定位地址', '当前值', '小数位',
      '是否被引用', '直接引用次数', '下游引用次数', '是否引用终点', '风险原因', '人工处理建议'
    ];
    const rows = issues.map((issue, index) => [
      index + 1, issue.riskLabel, issue.sheetName, issue.cell, issue.goto,
      issue.originalValue === null ? '' : issue.originalValue, formatDecimals(issue.decimals),
      riskCore.yesNo(issue.hasReference), issue.directReferenceCount, issue.downstreamReferenceCount,
      riskCore.yesNo(issue.isReferenceTerminal), issue.riskReason, issue.suggestion
    ]);
    return [header].concat(rows);
  }

  function buildFormulaAoa(issues) {
    const header = [
      '序号', '风险等级', '工作表', '单元格', 'F5定位地址', '公式', '计算结果', '业务类型',
      '有效小数位', '是否被引用', '直接引用次数', '下游引用次数', '是否引用终点', '风险原因', '人工处理建议'
    ];
    const rows = issues.map((issue, index) => [
      index + 1, issue.riskLabel, issue.sheetName, issue.cell, issue.goto,
      issue.originalFormula || '', issue.originalValue === null ? '' : issue.originalValue,
      issue.businessTypeLabel || '普通数值', formatDecimals(issue.decimals), riskCore.yesNo(issue.hasReference),
      issue.directReferenceCount, issue.downstreamReferenceCount, riskCore.yesNo(issue.isReferenceTerminal),
      issue.riskReason, issue.suggestion
    ]);
    return [header].concat(rows);
  }

  function buildHiddenAoa(issues) {
    const header = [
      '序号', '风险等级', '工作表', '单元格', 'F5定位地址', '隐藏类型', '当前值',
      '公式', '小数位', '是否百分比', '是否被引用', '直接引用次数', '下游引用次数',
      '风险原因', '人工处理建议'
    ];
    const rows = issues.map((issue, index) => [
      index + 1, issue.riskLabel, issue.sheetName, issue.cell, issue.goto, issue.hiddenLabel,
      issue.originalValue === null ? '' : issue.originalValue, issue.originalFormula || '',
      formatDecimals(issue.decimals), riskCore.yesNo(issue.isPercentage),
      riskCore.yesNo(issue.hasReference), issue.directReferenceCount, issue.downstreamReferenceCount,
      issue.riskReason, issue.suggestion
    ]);
    return [header].concat(rows);
  }

  function buildPercentageAoa(issues) {
    const header = [
      '序号', '风险等级', '工作表', '单元格', 'F5定位地址', '底层值', '显示格式',
      'Number Format', '有效小数位', '是否被引用', '直接引用次数', '下游引用次数',
      '是否引用终点', '风险原因', '人工处理建议'
    ];
    const rows = issues.map((issue, index) => [
      index + 1, issue.riskLabel, issue.sheetName, issue.cell, issue.goto,
      issue.originalValue === null ? '' : issue.originalValue, issue.displayValue || '',
      issue.numberFormat || '', formatDecimals(issue.decimals), riskCore.yesNo(issue.hasReference),
      issue.directReferenceCount, issue.downstreamReferenceCount, riskCore.yesNo(issue.isReferenceTerminal),
      issue.riskReason, issue.suggestion
    ]);
    return [header].concat(rows);
  }

  function buildUnknownAoa(issues) {
    const header = ['序号', '工作表', '单元格', 'F5定位地址', '公式', '是否被引用', '直接引用次数', '下游引用次数', '备注'];
    const rows = issues.map((issue, index) => [
      index + 1, issue.sheetName, issue.cell, issue.goto, issue.originalFormula || '',
      riskCore.yesNo(issue.hasReference), issue.directReferenceCount, issue.downstreamReferenceCount, UNKNOWN_NOTE
    ]);
    return [header].concat(rows);
  }

  function buildExchangeRateAoa(rates) {
    const header = [
      '序号', '工作表', '单元格', 'F5定位地址', '当前值', '公式', '类型', '来源汇率',
      '传递层级', '允许小数位', '实际有效小数位', '精度状态', '直接引用次数',
      '下游引用次数', '影响等级', '备注'
    ];
    const rows = rates.map((rate, index) => [
      index + 1, rate.sheetName, rate.cell, rate.goto,
      rate.originalValue === null || rate.originalValue === undefined ? '' : rate.originalValue,
      rate.formula || '', rate.typeLabel, rate.sourceGoto || '', rate.depth,
      rate.allowedDecimals, formatDecimals(rate.decimals), rate.precisionStatus,
      rate.directReferenceCount, rate.downstreamReferenceCount, rate.impact, rate.reason || ''
    ]);
    return [header].concat(rows);
  }

  function sortRates(rates) {
    return rates.slice().sort((a, b) => {
      const byDown = (b.downstreamReferenceCount || 0) - (a.downstreamReferenceCount || 0);
      if (byDown) return byDown;
      const byDirect = (b.directReferenceCount || 0) - (a.directReferenceCount || 0);
      if (byDirect) return byDirect;
      if (a.sheetName !== b.sheetName) return a.sheetName < b.sheetName ? -1 : 1;
      return (a.row - b.row) || (a.col - b.col);
    });
  }

  const SHEET_DEFS = [
    { name: riskCore.HIGH_RISK_SHEET, pick: (i) => i.riskLevel === riskCore.RISK.HIGH, aoa: buildHighRiskAoa,
      widths: [6, 16, 10, 24, 14, 16, 28, 9, 9, 11, 11, 11, 14, 9, 44, 44] },
    { name: riskCore.CATEGORY_SHEET[CATEGORY.RAW], pick: (i) => i.category === CATEGORY.RAW, aoa: buildRawAoa,
      widths: [6, 8, 16, 10, 24, 16, 8, 9, 11, 11, 11, 44, 44] },
    { name: riskCore.CATEGORY_SHEET[CATEGORY.FORMULA], pick: (i) => i.category === CATEGORY.FORMULA, aoa: buildFormulaAoa,
      widths: [6, 8, 16, 10, 24, 28, 16, 12, 9, 9, 11, 11, 11, 44, 44] },
    { name: riskCore.CATEGORY_SHEET[CATEGORY.HIDDEN], pick: (i) => i.category === CATEGORY.HIDDEN, aoa: buildHiddenAoa,
      widths: [6, 8, 16, 10, 24, 16, 16, 28, 8, 9, 9, 11, 11, 44, 44] },
    { name: riskCore.CATEGORY_SHEET[CATEGORY.PERCENTAGE], pick: (i) => i.category === CATEGORY.PERCENTAGE, aoa: buildPercentageAoa,
      widths: [6, 8, 16, 10, 24, 16, 14, 16, 9, 9, 11, 11, 11, 44, 44] },
    { name: riskCore.CATEGORY_SHEET[CATEGORY.UNKNOWN], pick: (i) => i.category === CATEGORY.UNKNOWN, aoa: buildUnknownAoa,
      widths: [6, 16, 10, 24, 28, 9, 11, 11, 60] },
    { name: riskCore.CATEGORY_SHEET[CATEGORY.EXCHANGE_RATE], pick: null, aoa: buildExchangeRateAoa,
      widths: [6, 16, 10, 24, 16, 24, 12, 24, 8, 11, 13, 12, 11, 11, 20, 40] }
  ];

  function buildIssuesWorkbook(XLSX, issues, options) {
    const list = Array.isArray(issues) ? issues : [];
    const opts = options || {};
    const rates = Array.isArray(opts.rates) ? opts.rates : [];
    const wb = XLSX.utils.book_new();
    SHEET_DEFS.forEach((def) => {
      const aoa = def.name === riskCore.CATEGORY_SHEET[CATEGORY.EXCHANGE_RATE]
        ? def.aoa(sortRates(rates))
        : def.aoa(sortForExport(list.filter(def.pick)));
      const ws = aoaToSheet(XLSX, aoa, def.widths);
      XLSX.utils.book_append_sheet(wb, ws, def.name);
    });
    return wb;
  }

  return {
    readOptions,
    scanWorkbook,
    buildHiddenMeta,
    buildIssuesWorkbook,
    sortForExport,
    sortRates,
    formatDecimals,
    SHEET_DEFS,
    UNKNOWN_NOTE
  };
});
