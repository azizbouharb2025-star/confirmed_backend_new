const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../config/redis');

// Create a Redis-backed store with fallback to memory
class RedisStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.resetTime = Date.now() + windowMs;
    this.localStore = new Map(); // Fallback store
  }

  async increment(key) {
    const redis = getRedisClient();
    
    if (!redis) {
      // Fallback to in-memory store
      const current = (this.localStore.get(key) || 0) + 1;
      this.localStore.set(key, current);
      return {
        totalHits: current,
        resetTime: this.resetTime
      };
    }

    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, Math.ceil(this.windowMs / 1000));
      }
      return {
        totalHits: current,
        resetTime: new Date(Date.now() + this.windowMs)
      };
    } catch (error) {
      // Fallback on Redis error
      const current = (this.localStore.get(key) || 0) + 1;
      this.localStore.set(key, current);
      return {
        totalHits: current,
        resetTime: this.resetTime
      };
    }
  }

  async decrement(key) {
    const redis = getRedisClient();
    if (!redis) {
      const current = this.localStore.get(key) || 0;
      if (current > 0) this.localStore.set(key, current - 1);
      return;
    }
    try {
      await redis.decr(key);
    } catch (error) {
      // Ignore errors
    }
  }

  async resetKey(key) {
    const redis = getRedisClient();
    if (!redis) {
      this.localStore.delete(key);
      return;
    }
    try {
      await redis.del(key);
    } catch (error) {
      // Ignore errors
    }
  }
}

const createLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore(windowMs)
  });
};

const limiters = {
  auth: createLimiter(15 * 60 * 1000, 20, 'Too many auth attempts'),
  api: createLimiter(15 * 60 * 1000, 500, 'Too many API requests'),
  webhook: createLimiter(60 * 1000, 50, 'Too many webhook requests')
};

module.exports = limiters;