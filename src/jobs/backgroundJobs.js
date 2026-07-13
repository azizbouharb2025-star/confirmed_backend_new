const cron = require('node-cron');
const aiService = require('../services/aiService');
const queueService = require('../services/queueService');
const logger = require('../utils/logger');

class BackgroundJobs {
  start() {
    // Process AI calls every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Processing AI call queue');
      await aiService.processAIQueue();
    });

    // Distribute orders every minute
    cron.schedule('* * * * *', async () => {
      await queueService.distributeOrders();
    });

    // Clean up old logs daily at midnight
    cron.schedule('0 0 * * *', async () => {
      logger.info('Cleaning up old logs');
      // Implement log cleanup logic
    });

    logger.info('Background jobs started');
  }
}

module.exports = new BackgroundJobs();