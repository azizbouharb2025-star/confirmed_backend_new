const ActivityLog = require('../models/ActivityLog');
const logger = require('../utils/logger');

/**
 * Log an activity event for the admin activity feed.
 * @param {'user'|'order'|'system'|'payment'} type
 * @param {string} action - e.g. "New user registered"
 * @param {string} [detail] - e.g. email or order ID
 */
const logActivity = async (type, action, detail = null) => {
  try {
    await ActivityLog.create({ type, action, detail });
  } catch (err) {
    logger.error('Failed to log activity:', err.message);
  }
};

module.exports = { logActivity };
