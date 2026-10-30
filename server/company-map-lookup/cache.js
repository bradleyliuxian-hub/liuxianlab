'use strict';

class TtlMemoryCache {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.ttlMs <= 0) return;
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  prune() {
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }
}

module.exports = { TtlMemoryCache };
