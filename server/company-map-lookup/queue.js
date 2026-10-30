'use strict';

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = [];
  const count = Math.min(Math.max(1, concurrency), items.length || 1);
  for (let i = 0; i < count; i += 1) runners.push(run());
  await Promise.all(runners);
  return results;
}

module.exports = { mapLimit };
