const express = require('express');
const Joi = require('joi');
const Order = require('../models/Order');
const { auth, authorize } = require('../middleware/auth');
const { getRedisClient } = require('../config/redis');
const orderService = require('../services/orderService');
const exportService = require('../services/exportService');
const { applyTierFilters } = require('../middleware/tierCheck');

const router = express.Router();

const createOrderSchema = Joi.object({
  orderId: Joi.string().required(),
  clientInfo: Joi.object({
    name: Joi.string().required(),
    phone: Joi.string().required(),
    email: Joi.string().email(),
    address: Joi.object({
      street: Joi.string(),
      city: Joi.string(),
      state: Joi.string(),
      zipCode: Joi.string(),
      country: Joi.string()
    })
  }).required(),
  items: Joi.array().items(Joi.object({
    name: Joi.string(),
    quantity: Joi.number(),
    price: Joi.number(),
    sku: Joi.string()
  })),
  totalAmount: Joi.number().required(),
  deliveryInfo: Joi.object({
    estimatedDate: Joi.date(),
    trackingNumber: Joi.string(),
    carrier: Joi.string()
  })
});

const bulkStatusSchema = Joi.object({
  orderIds: Joi.array().items(Joi.string()).min(1).required(),
  status: Joi.string().valid('pending', 'confirmed', 'called', 'delivered', 'cancelled').required()
});

/**
 * POST /api/orders
 * Create a new order
 * Emits order:created WebSocket event
 * Requirements: 11.2
 */
router.post('/', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { error } = createOrderSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const order = await orderService.createOrder({
      ...req.body,
      shopId: req.user.shopId
    });

    // Add to call queue if Redis is available
    const redis = getRedisClient();
    if (redis) {
      await redis.lPush('call_queue', JSON.stringify({
        orderId: order._id,
        shopId: order.shopId,
        priority: order.priority,
        timestamp: new Date()
      }));
    }

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/recent
 * Get recent orders for dashboard widget
 */
router.get('/recent', auth, async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    
    const query = shopId ? { shopId } : {};
    
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('orderId clientInfo.name totalAmount status createdAt items')
      .lean();
    
    res.json(orders.map(order => ({
      id: order._id,
      orderId: order.orderId,
      customerName: order.clientInfo?.name || 'Unknown',
      amount: order.totalAmount,
      status: order.status,
      createdAt: order.createdAt,
      itemCount: order.items?.length || 0
    })));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders
 * List orders with pagination, filtering, search, and sorting
 * Supports tier-specific filters (Pro: aiScore, Business: region/courier)
 * Admin users can filter by shopId
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.1, 8.1, 8.2, 10.1
 */
router.get('/', auth, applyTierFilters(), async (req, res, next) => {
  try {
    // Use tier-filtered query parameters
    const filters = req.tierFilteredQuery || req.query;
    
    const result = await orderService.findOrders(filters, req.user);
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/:id
 * Get single order details with shop ownership validation
 * Requirements: 2.1, 2.2, 2.3
 */
router.get('/:id', auth, async (req, res, next) => {
  try {
    const order = await orderService.findOrderById(req.params.id, req.user);
    res.json(order);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * PATCH /api/orders/:id/status
 * Update order status and add call history entry
 * Requirements: 3.1, 3.2, 3.3
 */
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    
    const validStatuses = ['pending', 'confirmed', 'called', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(422).json({ error: 'Invalid status value' });
    }
    
    const order = await orderService.updateOrderStatus(
      req.params.id,
      status,
      notes || '',
      req.user
    );
    
    res.json(order);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * PATCH /api/orders/:id/assign
 * Assign operator to order (admin only)
 * Requirements: 4.1, 4.2, 4.3
 */
router.patch('/:id/assign', auth, async (req, res, next) => {
  try {
    // Check admin authorization
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const { operatorId } = req.body;
    
    if (!operatorId) {
      return res.status(400).json({ error: 'Operator ID is required' });
    }
    
    const order = await orderService.assignOperator(
      req.params.id,
      operatorId,
      req.user
    );
    
    res.json(order);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * POST /api/orders/bulk-status
 * Bulk status update for multiple orders
 * Requirements: 5.1, 5.2, 5.3
 */
router.post('/bulk-status', auth, async (req, res, next) => {
  try {
    const { error } = bulkStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const { orderIds, status } = req.body;
    
    const result = await orderService.bulkUpdateStatus(orderIds, status, req.user);
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/export
 * Export orders to CSV format
 * Requirements: 6.1, 6.2, 6.3
 */
router.post('/export', auth, applyTierFilters(), async (req, res, next) => {
  try {
    // Use tier-filtered query parameters from request body or query
    const filters = req.tierFilteredQuery || req.body || {};
    
    const csv = await exportService.exportOrdersToCSV(filters, req.user);
    
    // Set appropriate headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
    
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/orders/:id
 * Delete an order
 * Emits order:delete WebSocket event
 * Requirements: 11.3
 */
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const order = await orderService.deleteOrder(req.params.id, req.user);
    res.json({ message: 'Order deleted successfully', orderId: order._id });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;
