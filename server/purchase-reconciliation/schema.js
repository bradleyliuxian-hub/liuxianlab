'use strict';

/*
 * Canonical labels mirror services/purchase_reconciliation/schema.py.
 * Python remains the source of truth for aliases and engine behaviour; this
 * file only exists so the HTTP layer can validate field names and render the
 * rule panel without parsing Python.
 */

const FIELD_LABELS = {
  delivery_date: '送货日期',
  supplier: '供应商',
  purchase_order: '采购订单',
  purchase_order_item: '采购订单项目',
  material_code: '物料编码',
  material_description: '物料描述',
  order_unit: '订单单位',
  quantity: '数量',
  unit_price: '单价',
  per: '每',
  amount: '总金额',
  movement_type: '移动类型'
};

const DEFAULT_MATCH_FIELDS = [
  'supplier',
  'purchase_order',
  'purchase_order_item',
  'material_code',
  'order_unit',
  'unit_price',
  'per'
];

const REQUIRED_FIELDS = [
  'delivery_date',
  'supplier',
  'purchase_order',
  'purchase_order_item',
  'material_code',
  'order_unit',
  'quantity',
  'unit_price',
  'per',
  'amount',
  'movement_type'
];

const FIELD_SCHEMA = Object.entries(FIELD_LABELS).map(([key, label]) => ({
  key,
  label,
  required: REQUIRED_FIELDS.includes(key),
  numeric: ['quantity', 'unit_price', 'per', 'amount'].includes(key),
  date: key === 'delivery_date',
  matchable: DEFAULT_MATCH_FIELDS.includes(key)
}));

module.exports = {
  FIELD_LABELS,
  DEFAULT_MATCH_FIELDS,
  REQUIRED_FIELDS,
  FIELD_SCHEMA
};
