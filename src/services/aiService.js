const axios = require('axios');
const Order = require('../models/Order');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.apiUrl = process.env.AI_SERVICE_URL;
    this.apiKey = process.env.AI_SERVICE_API_KEY;
  }

  async makeCall(orderId) {
    try {
      const order = await Order.findById(orderId).populate('shopId');
      if (!order) throw new Error('Order not found');

      const callData = {
        phone: order.clientInfo.phone,
        customerName: order.clientInfo.name,
        orderDetails: {
          orderId: order.orderId,
          items: order.items,
          totalAmount: order.totalAmount,
          deliveryInfo: order.deliveryInfo
        }
      };

      const response = await axios.post(`${this.apiUrl}/make-call`, callData, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      // Update order with AI call result
      order.callHistory.push({
        callType: 'ai',
        timestamp: new Date(),
        duration: response.data.duration,
        result: response.data.result,
        notes: response.data.transcript
      });

      if (response.data.result === 'confirmed') {
        order.status = 'confirmed';
      }

      await order.save();
      logger.info(`AI call completed for order ${orderId}: ${response.data.result}`);
      
      return response.data;
    } catch (error) {
      logger.error(`AI call failed for order ${orderId}:`, error);
      throw error;
    }
  }

  async processAIQueue() {
    try {
      const pendingOrders = await Order.find({
        status: 'pending',
        assignedOperatorId: null
      }).populate('shopId');

      for (const order of pendingOrders) {
        if (order.shopId.settings.aiCallsEnabled) {
          await this.makeCall(order._id);
        }
      }
    } catch (error) {
      logger.error('Error processing AI queue:', error);
    }
  }
}

module.exports = new AIService();