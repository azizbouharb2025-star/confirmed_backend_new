const express = require('express');
const mongoose = require('mongoose');
const { getRedisClient } = require('../config/redis');
const callQueue = require('../queues/callQueue');

const router = express.Router();

// Basic health check
router.get('/', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    // Check MongoDB
    const dbState = mongoose.connection.readyState;
    health.services.mongodb = {
      status: dbState === 1 ? 'connected' : 'disconnected',
      state: dbState
    };

    // Check Redis
    const redis = getRedisClient();
    const redisPing = await redis.ping();
    health.services.redis = {
      status: redisPing === 'PONG' ? 'connected' : 'disconnected',
      response: redisPing
    };

    // Check Queue
    const queueHealth = await callQueue.checkHealth();
    health.services.queue = {
      status: 'active',
      waiting: queueHealth.waiting,
      active: queueHealth.active,
      completed: queueHealth.completed,
      failed: queueHealth.failed
    };

    // Overall status
    const allHealthy = Object.values(health.services).every(
      service => service.status === 'connected' || service.status === 'active'
    );
    
    health.status = allHealthy ? 'OK' : 'DEGRADED';
    
    res.status(allHealthy ? 200 : 503).json(health);
  } catch (error) {
    health.status = 'ERROR';
    health.error = error.message;
    res.status(503).json(health);
  }
});

// Readiness probe
router.get('/ready', async (req, res) => {
  try {
    // Check if all critical services are ready
    const dbReady = mongoose.connection.readyState === 1;
    const redis = getRedisClient();
    const redisReady = await redis.ping() === 'PONG';
    
    if (dbReady && redisReady) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

// Liveness probe
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

module.exports = router;