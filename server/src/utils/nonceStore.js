'use strict';

/**
 * Replay-protection nonce store (threat T2).
 *
 * Interface:
 *   checkAndStore(key, ttlSeconds) -> Promise<boolean>  // false == already seen
 *   size() -> number
 *   clear() -> void
 *
 * The default implementation is an in-process TTL map, which is correct for a
 * single API instance. For a multi-instance deployment, the SAME interface can
 * be backed by Redis (`SET key 1 NX EX ttl`) without touching any caller:
 *
 *   class RedisNonceStore {
 *     async checkAndStore(key, ttl) {
 *       const res = await redis.set(`nonce:${key}`, '1', 'EX', ttl, 'NX');
 *       return res === 'OK';
 *     }
 *   }
 *
 * Set REDIS_URL and swap the factory below to enable that path.
 */

const logger = require('../config/logger');

class MemoryNonceStore {
  constructor() {
    /** @type {Map<string, number>} key -> expiry epoch ms */
    this.map = new Map();
    this.lastSweep = Date.now();
  }

  /** Remove expired entries; amortised so it is cheap on the hot path. */
  sweep() {
    const now = Date.now();
    if (now - this.lastSweep < 10_000) return;
    this.lastSweep = now;
    for (const [key, expiry] of this.map) {
      if (expiry <= now) this.map.delete(key);
    }
  }

  /**
   * Atomically register a nonce.
   * @returns {Promise<boolean>} true when it is new (request may proceed)
   */
  async checkAndStore(key, ttlSeconds) {
    this.sweep();
    const now = Date.now();
    const existing = this.map.get(key);
    if (existing && existing > now) return false;
    this.map.set(key, now + ttlSeconds * 1000);
    return true;
  }

  size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

let instance = null;

/** @returns {MemoryNonceStore} the process-wide nonce store */
function getNonceStore() {
  if (!instance) {
    instance = new MemoryNonceStore();
    logger.info('nonce store initialised (in-memory)');
  }
  return instance;
}

module.exports = { getNonceStore, MemoryNonceStore };
