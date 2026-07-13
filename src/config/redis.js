const redis = require('redis');
const logger = require('../utils/logger');

let client;

const connectRedis = async () => {
  try {
    client = redis.createClient({
      url: process.env.REDIS_URL
    });

    client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    await client.connect();
    logger.info('Redis Connected');
  } catch (error) {
    logger.warn('Redis connection failed, running without Redis:', error.message);
    client = null;
  }
};

const getRedisClient = () => {
  if (!client) {
    logger.warn('Redis client not available');
    return null;
  }
  return client;
};

module.exports = { connectRedis, getRedisClient };