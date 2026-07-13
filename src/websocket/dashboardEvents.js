const logger = require('../utils/logger');

// Store io instance for use in emit functions
let ioInstance = null;

/**
 * Setup dashboard WebSocket event handlers
 * @param {Server} io - Socket.IO server instance
 */
const setupDashboardEvents = (io) => {
  ioInstance = io;
};

/**
 * Emit subscription:changed event when user's plan changes
 * @param {string} userId - User ID
 * @param {Object} subscription - New subscription data
 */
const emitSubscriptionChanged = (userId, subscription) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit subscription:changed');
    return;
  }

  const message = {
    type: 'subscription:changed',
    payload: {
      plan: subscription.plan,
      features: subscription.features
    },
    timestamp: new Date().toISOString()
  };

  // Emit to user-specific room
  ioInstance.to(`user:${userId}`).emit('subscription:changed', message);
  logger.info(`Emitted subscription:changed for user ${userId}`);
};

/**
 * Emit dashboard:metrics:updated for real-time metric updates
 * @param {string} shopId - Shop ID (optional, null for all)
 * @param {Object} metrics - Updated metrics
 */
const emitDashboardMetricsUpdated = (shopId, metrics) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit dashboard:metrics:updated');
    return;
  }

  const message = {
    type: 'dashboard:metrics:updated',
    payload: metrics,
    timestamp: new Date().toISOString()
  };

  if (shopId) {
    ioInstance.to(`shop:${shopId}`).emit('dashboard:metrics:updated', message);
    logger.info(`Emitted dashboard:metrics:updated to shop ${shopId}`);
  } else {
    // Emit to admin room for global updates
    ioInstance.to('admin').emit('dashboard:metrics:updated', message);
    logger.info('Emitted dashboard:metrics:updated to admin room');
  }
};

/**
 * Get the Socket.IO instance
 * @returns {Server|null} Socket.IO server instance
 */
const getIO = () => ioInstance;

module.exports = {
  setupDashboardEvents,
  emitSubscriptionChanged,
  emitDashboardMetricsUpdated,
  getIO
};
