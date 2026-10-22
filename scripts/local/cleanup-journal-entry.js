#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { createCleanupService } = require(path.join(ROOT, 'server', 'journal-entry', 'cleanup.js'));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const service = createCleanupService({ root: ROOT });
  console.log(JSON.stringify({
    storage: 'storage/journal-entry{, -batches, -splits}',
    retentionHours: service.retentionHours,
    outputRetentionHours: service.outputRetentionHours,
    orphanSafetyHours: service.orphanSafetyHours,
    dryRun
  }, null, 2));
  const stats = await service.run({ dryRun });
  console.log(JSON.stringify(stats, null, 2));
  if (stats.errors) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Journal Entry cleanup failed:', error.message);
  process.exitCode = 1;
});
