const { getRedisClient } = require('../config/redis');
const Order = require('../models/Order');
const User = require('../models/User');
const logger = require('../utils/logger');

class QueueService {
  constructor() {
    this.redis = getRedisClient();
  }

  async assignNextOrder(operatorId) {
    try {
      if (!this.redis) {
        // Fallback: get oldest pending order
        const order = await Order.findOneAndUpdate(
          { status: 'pending', assignedOperatorId: null },
          { assignedOperatorId: operatorId },
          { new: true, sort: { createdAt: 1 } }
        ).populate('shopId');
        
        if (order) {
          logger.info(`Order ${order._id} assigned to operator ${operatorId}`);
        }
        return order;
      }

      // Get next order from queue
      const queueItem = await this.redis.rPop('call_queue');
      if (!queueItem) return null;

      const { orderId } = JSON.parse(queueItem);
      
      // Assign order to operator
      const order = await Order.findByIdAndUpdate(
        orderId,
        { assignedOperatorId: operatorId },
        { new: true }
      ).populate('shopId');

      logger.info(`Order ${orderId} assigned to operator ${operatorId}`);
      return order;
    } catch (error) {
      logger.error('Error assigning order:', error);
      throw error;
    }
  }

  async getQueueLength() {
    if (!this.redis) {
      return await Order.countDocuments({ status: 'pending', assignedOperatorId: null });
    }
    return await this.redis.lLen('call_queue');
  }

  async getOperatorStats(operatorId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await Order.aggregate([
      {
        $match: {
          assignedOperatorId: operatorId,
          updatedAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    return stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});
  }

  async distributeOrders() {
    try {
      // Get available operators
      const operators = await User.find({
        role: 'operator',
        isActive: true
      });

      if (operators.length === 0) return;

      // Simple round-robin distribution
      for (const operator of operators) {
        const assignedCount = await Order.countDocuments({
          assignedOperatorId: operator._id,
          status: { $in: ['pending', 'called'] }
        });

        // Assign new order if operator has less than 5 pending orders
        if (assignedCount < 5) {
          await this.assignNextOrder(operator._id);
        }
      }
    } catch (error) {
      logger.error('Error distributing orders:', error);
    }
  }
}

module.exports = new QueueService();