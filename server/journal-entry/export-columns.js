'use strict';

const COLUMN_GROUPS = [
  { id: 'core', label: '财务核心字段' },
  { id: 'aux', label: '往来与辅助核算' },
  { id: 'other', label: '其他业务字段' },
  { id: 'source', label: '来源与系统追溯' },
  { id: 'advanced', label: '高级系统字段' }
];

const COLUMN_DEFINITIONS = [
  { id: 'date', label: '日期', group: 'core', default: true, kind: 'date' },
  { id: 'voucher_id', label: '凭证号', group: 'core', default: true, kind: 'text' },
  { id: 'description', label: '摘要', group: 'core', default: true, kind: 'text' },
  { id: 'account_code', label: '科目编码', group: 'core', default: true, kind: 'text' },
  { id: 'account_name', label: '科目名称', group: 'core', default: true, kind: 'text' },
  { id: 'detail_account', label: '明细科目', group: 'core', default: true, kind: 'text' },
  { id: 'debit', label: '借方金额', group: 'core', default: true, kind: 'amount' },
  { id: 'credit', label: '贷方金额', group: 'core', default: true, kind: 'amount' },
  { id: 'customer_code', label: '客户编码', group: 'aux', defaultIfData: true, kind: 'text' },
  { id: 'customer_name', label: '客户名称', group: 'aux', defaultIfData: true, kind: 'text' },
  { id: 'supplier_code', label: '供应商编码', group: 'aux', defaultIfData: true, kind: 'text' },
  { id: 'supplier_name', label: '供应商名称', group: 'aux', defaultIfData: true, kind: 'text' },
  { id: 'counterparty_code', label: '往来单位编码', group: 'aux', defaultIfData: true, kind: 'text' },
  { id: 'counterparty_name', label: '往来单位名称', group: 'aux', defaultIfData: true, kind: 'text' },
  { id: 'entity', label: '主体', group: 'other', defaultIfData: true, kind: 'text' },
  { id: 'period', label: '会计期间', group: 'other', defaultIfData: true, kind: 'text' },
  { id: 'currency', label: '币种', group: 'other', defaultIfData: true, kind: 'text' },
  { id: 'original_amount', label: '原币金额', group: 'other', defaultIfData: true, kind: 'amount' },
  { id: 'preparer', label: '制单人', group: 'other', defaultIfData: true, kind: 'text' },
  { id: 'original_filename', label: '原始文件', group: 'source', kind: 'text' },
  { id: 'sheet_name', label: '源 Sheet', group: 'source', kind: 'text' },
  { id: 'source_row', label: '源行号', group: 'source', kind: 'number' },
  { id: 'line_id', label: '外部行 ID', group: 'advanced', advanced: true, kind: 'text' },
  { id: 'internal_line_key', label: '内部行标识（系统追溯）', group: 'advanced', advanced: true, kind: 'key' },
  { id: 'job_id', label: '任务 ID（系统字段）', group: 'advanced', advanced: true, kind: 'key' },
  { id: 'voucher_key', label: '凭证内部标识（系统字段）', group: 'advanced', advanced: true, kind: 'key' }
];

const DEFAULT_COLUMN_ORDER = [
  'date', 'voucher_id', 'description', 'account_code', 'account_name',
  'detail_account', 'customer_code', 'customer_name', 'supplier_code',
  'supplier_name', 'counterparty_code', 'counterparty_name', 'debit',
  'credit', 'currency', 'original_amount', 'preparer', 'entity', 'period',
  'original_filename', 'sheet_name', 'source_row', 'line_id',
  'internal_line_key', 'job_id', 'voucher_key'
];

const COLUMN_IDS = new Set(COLUMN_DEFINITIONS.map((item) => item.id));

class ColumnValidationError extends Error {}

function cleanColumns(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.length) {
    throw new ColumnValidationError('至少选择 1 个导出字段。');
  }
  const columns = [];
  for (const item of value) {
    const id = String(item || '').trim();
    if (!COLUMN_IDS.has(id)) throw new ColumnValidationError('导出字段无效。');
    if (columns.includes(id)) throw new ColumnValidationError('导出字段不能重复。');
    columns.push(id);
  }
  if (!columns.length) throw new ColumnValidationError('至少选择 1 个导出字段。');
  return columns;
}

module.exports = {
  COLUMN_GROUPS,
  COLUMN_DEFINITIONS,
  DEFAULT_COLUMN_ORDER,
  ColumnValidationError,
  cleanColumns
};
