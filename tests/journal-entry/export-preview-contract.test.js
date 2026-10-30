'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-export-contract-'));

const { createStandardExportRouter } = require(
  path.join(ROOT, 'server', 'journal-entry', 'standard-export-routes.js')
);

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('frontend standard preview uses the mounted standard export API', () => {
  const frontend = fs.readFileSync(
    path.join(ROOT, 'private', 'tools', 'journal-entry-analysis', 'standard-preview.js'),
    'utf8'
  );
  assert.match(frontend, /const API = '\/api\/journal-entry-standard-exports';/);
  assert.match(frontend, /api\(`\$\{API\}\/preview`, \{\s*method: 'POST'/);
  assert.match(frontend, /fetch\(`\$\{API\}\/\$\{state\.reportMode \? 'report' : 'export'\}`/);

  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(
    server,
    /app\.use\('\/api\/journal-entry-standard-exports',\s*requireAuth,\s*sameOriginForStateChange,\s*createStandardExportRouter/
  );
  assert.match(
    server,
    /journal-entry-standard-exports\\\/\(preview\|export\|report\)/
  );
});

test('standard export router exposes preview/export/report POST routes', () => {
  const router = createStandardExportRouter({
    root: tempRoot,
    requireAuth: (_req, _res, next) => next(),
    runner: {}
  });
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods)
    }));
  assert.deepEqual(
    routes.filter((route) => route.methods.includes('post')).map((route) => route.path).sort(),
    ['/export', '/preview', '/report'].sort()
  );
  assert.ok(routes.some((route) => route.path === '/meta' && route.methods.includes('get')));
});
