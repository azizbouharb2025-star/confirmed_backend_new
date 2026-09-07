const { getRedisClient } = require('../config/redis');
const Order = require('../models/Order');
const User = require('../models/User');
const logger = require('../utils/logger');

class QueueService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Réactiver les commandes reportées dont la date
   * de rappel est arrivée.
   *
   * Elles restent affectées au même opérateur.
   */
  async reactivateDuePostponedOrders(
    operatorId,
    shopId = null
  ) {
    const now = new Date();

    const query = {
      status: 'postponed',
      assignedOperatorId: operatorId,
      'postponement.scheduledFor': {
        $lte: now
      }
    };

    if (shopId) {
      query.shopId = shopId;
    }

    const result =
      await Order.updateMany(
        query,
        {
          $set: {
            status: 'assigned'
          },

          $push: {
            statusHistory: {
              status: 'assigned',
              timestamp: now,
              operatorId,
              source: 'system',
              reason:
                'Rappel arrivé à échéance'
            }
          }
        }
      );

    if (result.modifiedCount > 0) {
      logger.info(
        `${result.modifiedCount} commande(s) reportée(s) réactivée(s) pour l'opérateur ${operatorId}`
      );
    }

    return result.modifiedCount;
  }

  /**
   * File de travail réelle d'un opérateur.
   *
   * Contient :
   * - commandes pending encore libres
   * - commandes pending déjà affectées à cet opérateur
   * - commandes assigned / in_progress de cet opérateur
   *
   * Les commandes d'autres opérateurs sont exclues.
   */
  async getOperatorQueue(
    operatorId,
    shopId,
    limit = 50
  ) {
    await this.reactivateDuePostponedOrders(
      operatorId,
      shopId
    );

    const requestedLimit =
      Number.parseInt(limit, 10);

    const safeLimit =
      Number.isFinite(requestedLimit)
        ? Math.min(
            100,
            Math.max(1, requestedLimit)
          )
        : 50;

    const query = {
      shopId,

      $or: [
        {
          status: 'pending',

          $or: [
            {
              assignedOperatorId: null
            },
            {
              assignedOperatorId: {
                $exists: false
              }
            },
            {
              assignedOperatorId:
                operatorId
            }
          ]
        },

        {
          assignedOperatorId:
            operatorId,

          status: {
            $in: [
              'assigned',
              'in_progress'
            ]
          }
        }
      ]
    };

    const [orders, total] =
      await Promise.all([
        Order.find(query)
          .sort({
            createdAt: -1
          })
          .limit(safeLimit)
          .populate(
            'assignedOperatorId',
            'name firstName lastName email'
          )
          .populate(
            'shopId',
            'name domain'
          )
          .populate(
            'items.productId',
            'name price deliveryFee imageUrl productLink description sellerNotes'
          ),

        Order.countDocuments(query)
      ]);

    return {
      orders,
      total,
      limit: safeLimit
    };
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
          status: { $in: ['pending', 'assigned', 'in_progress'] }
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