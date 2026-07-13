const logger = require('../utils/logger');
const Order = require('../models/Order');

// Store io instance for use in emit functions
let ioInstance = null;

// Store order events for sync requests
const orderEventStore = [];
const MAX_EVENT_STORE_SIZE = 1000;

/**
 * Store an order event for sync requests
 * @param {string} type - Event type (order:new, order:update, order:delete)
 * @param {Object} payload - Event payload
 */
const storeOrderEvent = (type, payload) => {
  const event = {
    type,
    payload,
    timestamp: new Date().toISOString()
  };
  
  orderEventStore.push(event);
  
  // Keep store size bounded
  if (orderEventStore.length > MAX_EVENT_STORE_SIZE) {
    orderEventStore.shift();
  }
};

/**
 * Get order events since a given timestamp
 * @param {string} since - ISO 8601 timestamp
 * @returns {Array} Array of events after the timestamp
 */
const getEventsSince = (since) => {
  const sinceDate = new Date(since);
  return orderEventStore.filter(event => new Date(event.timestamp) > sinceDate);
};

/**
 * Setup WebSocket event handlers for order-related events
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.5**
 * 
 * @param {Server} io - Socket.IO server instance
 */
const setupOrderEvents = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    const user = socket.user;
    logger.info(`WebSocket client connected: ${socket.id}, user: ${user._id}`);

    // Subscribe client to shop-specific room
    if (user.shopId) {
      const shopRoom = `shop:${user.shopId}`;
      socket.join(shopRoom);
      logger.info(`Socket ${socket.id} joined room: ${shopRoom}`);
    }

    // Admin users can subscribe to all shops or specific shops
    if (user.role === 'admin') {
      socket.join('admin');
      logger.info(`Socket ${socket.id} joined admin room`);
    }

    // Handle manual room subscription (for admins to watch specific shops)
    socket.on('subscribe:shop', (shopId) => {
      if (user.role === 'admin') {
        const shopRoom = `shop:${shopId}`;
        socket.join(shopRoom);
        logger.info(`Admin socket ${socket.id} subscribed to: ${shopRoom}`);
      }
    });

    // Handle unsubscription
    socket.on('unsubscribe:shop', (shopId) => {
      const shopRoom = `shop:${shopId}`;
      socket.leave(shopRoom);
      logger.info(`Socket ${socket.id} unsubscribed from: ${shopRoom}`);
    });

    /**
     * Handle sync:request messages
     * Returns all order events that occurred after the specified timestamp
     * **Validates: Requirements 11.5**
     */
    socket.on('sync:request', async (data) => {
      try {
        const { since } = data?.payload || data || {};
        
        if (!since) {
          socket.emit('sync:error', { 
            error: 'Missing "since" timestamp in sync request' 
          });
          return;
        }

        // Get events from in-memory store
        const events = getEventsSince(since);
        
        // Also query database for orders modified since the timestamp
        // to ensure we don't miss any events
        const sinceDate = new Date(since);
        const userShopId = user.shopId;
        
        const query = {
          updatedAt: { $gt: sinceDate }
        };
        
        // Non-admin users only see their shop's orders
        if (user.role !== 'admin' && userShopId) {
          query.shopId = userShopId;
        }
        
        const recentOrders = await Order.find(query)
          .sort({ updatedAt: 1 })
          .limit(100);
        
        // Convert recent orders to events if not already in store
        const dbEvents = recentOrders.map(order => ({
          type: order.createdAt > sinceDate ? 'order:new' : 'order:update',
          payload: order,
          timestamp: order.updatedAt.toISOString()
        }));
        
        // Merge and deduplicate events
        const allEvents = [...events, ...dbEvents];
        const uniqueEvents = allEvents.reduce((acc, event) => {
          const key = `${event.type}-${event.payload._id || event.payload.orderId}-${event.timestamp}`;
          if (!acc.seen.has(key)) {
            acc.seen.add(key);
            acc.events.push(event);
          }
          return acc;
        }, { seen: new Set(), events: [] }).events;
        
        // Sort by timestamp
        uniqueEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        socket.emit('sync:response', { events: uniqueEvents });
        logger.info(`Sync response sent to ${socket.id}: ${uniqueEvents.length} events since ${since}`);
      } catch (error) {
        logger.error('Error handling sync:request:', error);
        socket.emit('sync:error', { error: 'Failed to process sync request' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });
};


/**
 * Emit order:update event to subscribed clients
 * Uses new message format: { type, payload, timestamp }
 * **Feature: orders-api-enhancement, Property 25: WebSocket Order Update Message Format**
 * **Validates: Requirements 11.1**
 * 
 * @param {Object} order - Updated order object
 */
const emitOrderUpdate = (order) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit order:update');
    return;
  }

  const timestamp = new Date().toISOString();
  
  // Enhanced payload with new fields
  const enhancedOrder = {
    ...order.toObject ? order.toObject() : order,
    aiScore: order.aiScore,
    riskLevel: order.riskLevel,
    hasComplaint: order.hasComplaint,
    deliverySuccessProbability: order.deliverySuccessProbability
  };
  
  const message = {
    type: 'order:update',
    payload: enhancedOrder,
    timestamp
  };

  // Store event for sync requests
  storeOrderEvent('order:update', enhancedOrder);

  const shopId = order.shopId?._id || order.shopId;
  if (shopId) {
    const shopRoom = `shop:${shopId}`;
    ioInstance.to(shopRoom).emit('order:update', message);
    logger.info(`Emitted order:update to room ${shopRoom} for order ${order._id}`);
  }

  // Also emit to admin room
  ioInstance.to('admin').emit('order:update', message);
};

/**
 * Emit order:new event to subscribed clients
 * Uses new message format: { type, payload, timestamp }
 * **Feature: orders-api-enhancement, Property 26: WebSocket Order New Message Format**
 * **Validates: Requirements 11.2**
 * 
 * @param {Object} order - New order object
 */
const emitOrderNew = (order) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit order:new');
    return;
  }

  const timestamp = new Date().toISOString();
  const message = {
    type: 'order:new',
    payload: order,
    timestamp
  };

  // Store event for sync requests
  storeOrderEvent('order:new', order);

  const shopId = order.shopId?._id || order.shopId;
  if (shopId) {
    const shopRoom = `shop:${shopId}`;
    ioInstance.to(shopRoom).emit('order:new', message);
    logger.info(`Emitted order:new to room ${shopRoom} for order ${order._id}`);
  }

  // Also emit to admin room
  ioInstance.to('admin').emit('order:new', message);
};

/**
 * Emit order:delete event to subscribed clients
 * Uses new message format: { type, payload: { orderId }, timestamp }
 * **Feature: orders-api-enhancement, Property 27: WebSocket Order Delete Message Format**
 * **Validates: Requirements 11.3**
 * 
 * @param {string} orderId - Deleted order ID
 * @param {string} shopId - Shop ID for room targeting
 */
const emitOrderDelete = (orderId, shopId) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit order:delete');
    return;
  }

  const timestamp = new Date().toISOString();
  const payload = { orderId: orderId.toString() };
  const message = {
    type: 'order:delete',
    payload,
    timestamp
  };

  // Store event for sync requests
  storeOrderEvent('order:delete', payload);

  if (shopId) {
    const resolvedShopId = shopId._id || shopId;
    const shopRoom = `shop:${resolvedShopId}`;
    ioInstance.to(shopRoom).emit('order:delete', message);
    logger.info(`Emitted order:delete to room ${shopRoom} for order ${orderId}`);
  }

  // Also emit to admin room
  ioInstance.to('admin').emit('order:delete', message);
};

// Backward compatibility aliases (deprecated)
const emitOrderUpdated = emitOrderUpdate;
const emitOrderCreated = emitOrderNew;

/**
 * Get the Socket.IO instance
 * @returns {Server|null} Socket.IO server instance
 */
const getIO = () => ioInstance;

/**
 * Get events since a timestamp (for testing)
 * @param {string} since - ISO 8601 timestamp
 * @returns {Array} Events since timestamp
 */
const getEventsSinceTimestamp = (since) => getEventsSince(since);

/**
 * Clear event store (for testing)
 */
const clearEventStore = () => {
  orderEventStore.length = 0;
};

module.exports = { 
  setupOrderEvents, 
  // New message format functions
  emitOrderUpdate,
  emitOrderNew,
  emitOrderDelete,
  // Backward compatibility (deprecated)
  emitOrderUpdated, 
  emitOrderCreated,
  // Utilities
  getIO,
  getEventsSinceTimestamp,
  clearEventStore
};
