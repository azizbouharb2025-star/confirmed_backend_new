const Order = require('../models/Order');
const logger = require('../utils/logger');
const { emitOrderUpdate, emitOrderNew, emitOrderDelete } = require('../websocket/orderEvents');
const { logActivity } = require('./activityLogService');

class OrderService {
  /**
   * Create a new order
   * Emits order:new WebSocket event on success
   * **Validates: Requirements 11.2**
   * 
   * @param {Object} orderData - Order data
   * @returns {Promise<Object>} Created order
   */
  async createOrder(orderData) {
    const order = new Order(orderData);
    await order.save();

    // Emit WebSocket event for real-time updates
    emitOrderNew(order);

    // Log activity
    logActivity('order', 'New order created', `#${order.orderId}`);

    return order;
  }

  /**
   * Find orders with pagination, filtering, search, and sorting
   * @param {Object} filters - Filter parameters
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Paginated result with orders, total, page, limit, totalPages
   */
  async findOrders(filters = {}, user = {}) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      // Tier-specific filters (handled by tier middleware)
      aiScoreMin,
      aiScoreMax,
      region,
      courier,
      // New filters
      filter,
      hasComplaint,
      // Admin-only filter
      shopId
    } = filters;

    // Ensure pagination values are within bounds
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    // Build query
    const query = {};

    // Shop filter - non-admin users can only see their own shop's orders
    if (user.role === 'admin' && shopId) {
      query.shopId = shopId;
    } else if (user.shopId) {
      query.shopId = user.shopId;
    }

    // Search across orderId, clientInfo.name, clientInfo.phone
    if (search) {
      // Escape special regex characters to prevent regex injection
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      query.$or = [
        { orderId: searchRegex },
        { 'clientInfo.name': searchRegex },
        { 'clientInfo.phone': searchRegex }
      ];
    }


    // Status filter
    if (status) {
      query.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Pro tier filters - AI score range
    if (aiScoreMin !== undefined || aiScoreMax !== undefined) {
      query.aiRiskScore = {};
      if (aiScoreMin !== undefined) {
        query.aiRiskScore.$gte = aiScoreMin;
      }
      if (aiScoreMax !== undefined) {
        query.aiRiskScore.$lte = aiScoreMax;
      }
    }

    // Special filter for risky orders
    if (filter === 'risky') {
      query.aiScore = { $lt: 50 };
    }

    // Business tier filters
    if (region) {
      query.region = region;
    }
    if (courier) {
      query.courier = courier;
    }

    // Complaint filter
    if (hasComplaint === 'true' || hasComplaint === true) {
      query.hasComplaint = true;
    }

    // Build sort object
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: sortDirection };

    try {
      // Get total count for pagination
      const total = await Order.countDocuments(query);

      // Calculate total pages
      const totalPages = Math.ceil(total / limitNum);

      // Get paginated orders
      const orders = await Order.find(query)
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('assignedOperatorId', 'name email')
        .populate('shopId', 'name domain')
        .populate('courier', 'name');

      return {
        orders,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding orders:', error);
      throw error;
    }
  }

  /**
   * Find a single order by ID
   * @param {string} id - Order ID (MongoDB _id)
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Order object
   */
  async findOrderById(id, user = {}) {
    const order = await Order.findById(id)
      .populate('assignedOperatorId', 'name email')
      .populate('shopId', 'name domain')
      .populate('items.productId', 'name price');

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    // Check shop ownership for non-admin users
    if (user.role !== 'admin' && user.shopId) {
      const orderShopId = order.shopId?._id || order.shopId;
      if (orderShopId && orderShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }
    }

    return order;
  }


  /**
   * Update order status and add call history entry
   * Emits order:updated WebSocket event on success
   * **Validates: Requirements 3.1, 3.2, 11.1**
   * 
   * @param {string} id - Order ID
   * @param {string} status - New status
   * @param {string} notes - Optional notes
   * @param {Object} user - Current user (operator)
   * @returns {Promise<Object>} Updated order
   */
  async updateOrderStatus(id, status, notes = '', user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    // Update status
    order.status = status;

    // Add call history entry
    order.callHistory.push({
      operatorId: user._id || user.id,
      callType: 'human',
      timestamp: new Date(),
      result: status === 'confirmed' ? 'confirmed' : 
              status === 'cancelled' ? 'rejected' : 'confirmed',
      notes
    });

    await order.save();

    // Emit WebSocket event for real-time updates
    emitOrderUpdate(order);

    return order;
  }

  /**
   * Assign an operator to an order
   * @param {string} id - Order ID
   * @param {string} operatorId - Operator user ID
   * @param {Object} user - Current user (must be admin)
   * @returns {Promise<Object>} Updated order
   */
  async assignOperator(id, operatorId, user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    order.assignedOperatorId = operatorId;
    await order.save();

    return order;
  }

  /**
   * Bulk update status for multiple orders
   * @param {string[]} orderIds - Array of order IDs
   * @param {string} status - New status
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Bulk operation result with successful, failed, errors
   */
  async bulkUpdateStatus(orderIds, status, user = {}) {
    const result = {
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const orderId of orderIds) {
      try {
        await this.updateOrderStatus(orderId, status, '', user);
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          orderId,
          error: error.message
        });
      }
    }

    return result;
  }

  /**
   * Delete an order
   * Emits order:delete WebSocket event on success
   * **Validates: Requirements 11.3**
   * 
   * @param {string} id - Order ID
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Deleted order
   */
  async deleteOrder(id, user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    // Check shop ownership for non-admin users
    if (user.role !== 'admin' && user.shopId) {
      const orderShopId = order.shopId?._id || order.shopId;
      if (orderShopId && orderShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }
    }

    const shopId = order.shopId;
    const orderId = order._id;

    await Order.findByIdAndDelete(id);

    // Emit WebSocket event for real-time updates
    emitOrderDelete(orderId, shopId);

    return order;
  }
}

module.exports = new OrderService();
