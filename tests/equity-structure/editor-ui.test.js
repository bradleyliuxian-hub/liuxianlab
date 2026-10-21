'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'private', 'tools', 'equity-structure');
const HTML = fs.readFileSync(path.join(TOOL, 'index.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(TOOL, 'script.js'), 'utf8');
const CSS = fs.readFileSync(path.join(TOOL, 'styles.css'), 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'tools.json'), 'utf8'));
const SCHEMA = fs.readFileSync(path.join(ROOT, 'services', 'equity_structure', 'schemas.py'), 'utf8');
const LAYOUT_PY = fs.readFileSync(path.join(ROOT, 'services', 'equity_structure', 'layout.py'), 'utf8');

test('equity editor version is synchronized', () => {
  const tool = CONFIG.find((item) => item.slug === 'equity-structure');
  assert.equal(tool.version, 'v1.2.2');
  assert.match(HTML, /v1\.2\.2/);
  assert.match(SCRIPT, /CURRENT_VERSION = 'v1\.2\.2'/);
  assert.match(SCRIPT, /version: 'v1\.2\.2'/);
});

test('editor exposes add, link, percentage, duplicate, delete and property controls', () => {
  for (const id of [
    'addCompanyButton', 'addPersonButton', 'addFundButton', 'addInstitutionButton', 'addOtherButton',
    'addEdgeButton', 'addLabelButton', 'duplicateButton', 'deleteButton', 'propertyPanel',
    'addRelatedButton', 'relatedDialog', 'relatedForm', 'relatedTarget', 'relatedName',
    'relatedType', 'relatedPercentage', 'relatedPreview', 'createRelatedButton'
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`));
  }
  for (const token of [
    'function addNode(', 'function insertNode(', 'function duplicateSelection(', 'function deleteSelection(',
    'function startLinkMode(', 'function addPercentageToEdge(', 'function applyThemeToAll(',
    'function renderPropertyPanel(', 'function updateNodeStyle(', 'function updateEdgeStyle(',
    'function updateLabelStyle(', 'function scheduleSaveAll(',
    'async function flushSaves(', 'const saved = await flushSaves()',
    'function openRelatedDialog(', 'function createRelatedCompany(', 'function rebaseLevels(',
    'function parseRelatedPercentage(', 'function updateRelatedForm(', 'function persistAutoLabel('
  ]) {
    assert.match(SCRIPT, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('editor state separates business, layout and styles', () => {
  assert.match(SCRIPT, /styles: \{ nodes: \{\}, edges: \{\}, labels: \{\}, canvas: \{\}, theme: 'audit' \}/);
  assert.match(SCRIPT, /data: cloneJson\(state\.data\)/);
  assert.match(SCRIPT, /nodes: cloneJson\(state\.editor\.nodes \|\| \{\}\)/);
  assert.match(SCRIPT, /labels: cloneJson\(state\.editor\.labels \|\| \{\}\)/);
  assert.match(SCRIPT, /styles: cloneJson\(editorStyles\(\)\)/);
  assert.match(SCRIPT, /styles: editorStyles\(\)/);
  assert.match(SCRIPT, /defaultTheme/);
});

test('header, content top and background bounds use stable layout constants', () => {
  assert.match(SCRIPT, /titleBaseline: 54/);
  assert.match(SCRIPT, /contentTop: 120/);
  assert.match(SCRIPT, /footerPadding: 80/);
  assert.match(SCRIPT, /function normalizeManualLayout\(\)/);
  assert.match(SCRIPT, /const top = LAYOUT\.contentTop/);
  assert.match(SCRIPT, /rebaseLevels\(1\)/);
  assert.match(SCRIPT, /relation: mode === 'upstream' && isCoreNode\(target\) \? 'shareholder_to_core' : 'investment'/);
  assert.match(SCRIPT, /titleY: LAYOUT\.titleBaseline/);
  assert.match(LAYOUT_PY, /CONTENT_TOP = 120/);
  assert.match(LAYOUT_PY, /TITLE_BASELINE = 54/);
  assert.match(LAYOUT_PY, /FOOTER_PADDING = 80/);
});

test('editor supports keyboard undo/redo/delete/escape and themes', () => {
  assert.match(SCRIPT, /event\.key\.toLowerCase\(\) === 'z'/);
  assert.match(SCRIPT, /event\.key\.toLowerCase\(\) === 'y'/);
  assert.match(SCRIPT, /event\.key === 'Delete'/);
  assert.match(SCRIPT, /event\.key === 'Escape'/);
  for (const theme of ['审计米金', '简约灰白', '蓝灰商务', '自定义主题']) {
    assert.match(SCRIPT, new RegExp(theme));
  }
  assert.match(CSS, /\.property-panel/);
});

test('python schema accepts institution and preserves edge client id', () => {
  assert.match(SCHEMA, /ENTITY_TYPES = \{"company", "person", "fund", "institution", "other"\}/);
  assert.match(SCHEMA, /client_id: str = ""/);
  assert.match(SCHEMA, /client_id=_text\(payload\.get\("__id"\)\)/);
});
