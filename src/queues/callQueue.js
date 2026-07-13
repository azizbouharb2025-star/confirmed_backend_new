const Queue = require('bull');
const aiService = require('../services/aiService');
const Order = require('../models/Order');
const logger = require('../utils/logger');

const callQueue = new Queue('call processing', process.env.REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Process AI calls
callQueue.process('ai-call', 5, async (job) => {
  const { orderId } = job.data;
  
  try {
    logger.info(`Processing AI call for order ${orderId}`);
    const result = await aiService.makeCall(orderId);
    
    return result;
  } catch (error) {
    logger.error(`AI call failed for order ${orderId}:`, error);
    
    // Mark order as failed after max retries
    if (job.attemptsMade >= job.opts.attempts) {
      await Order.findByIdAndUpdate(orderId, {
        status: 'call_failed',
        $push: {
          callHistory: {
            callType: 'ai',
            timestamp: new Date(),
            result: 'failed',
            notes: 'Max retry attempts reached'
          }
        }
      });
    }
    
    throw error;
  }
});

// Process operator assignments
callQueue.process('assign-operator', 10, async (job) => {
  const { orderId, operatorId } = job.data;
  
  try {
    await Order.findByIdAndUpdate(orderId, {
      assignedOperatorId: operatorId,
      status: 'assigned'
    });
    
    logger.info(`Order ${orderId} assigned to operator ${operatorId}`);
  } catch (error) {
    logger.error(`Failed to assign order ${orderId}:`, error);
    throw error;
  }
});

// Queue monitoring
callQueue.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

callQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed:`, err);
});

module.exports = callQueue;