const logger = require('../utils/logger');

// Store io instance for use in emit functions
let ioInstance = null;

/**
 * Setup WebSocket event handlers for complaint-related events
 * **Validates: Requirements 8.1, 8.2, 8.3**
 * 
 * @param {Server} io - Socket.IO server instance
 */
const setupComplaintEvents = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    const user = socket.user;
    
    // Users are already subscribed to shop rooms via orderEvents
    // This setup ensures complaint events can be emitted to those rooms
    
    // Handle manual room subscription for complaints (for admins)
    socket.on('subscribe:complaints', (shopId) => {
      if (user.role === 'admin') {
        const shopRoom = `shop:${shopId}`;
        socket.join(shopRoom);
        logger.info(`Admin socket ${socket.id} subscribed to complaints for: ${shopRoom}`);
      }
    });

    // Handle unsubscription from complaint notifications
    socket.on('unsubscribe:complaints', (shopId) => {
      const shopRoom = `shop:${shopId}`;
      socket.leave(shopRoom);
      logger.info(`Socket ${socket.id} unsubscribed from complaints for: ${shopRoom}`);
    });
  });
};

/**
 * Emit complaint:new event to subscribed clients
 * Uses message format: { type, payload, timestamp } consistent with order events
 * **Feature: complaint-management, Property 26: WebSocket Notification Format**
 * **Validates: Requirements 8.1, 8.3**
 * 
 * @param {Object} complaint - New complaint object
 */
const emitComplaintNew = (complaint) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit complaint:new');
    return;
  }

  const timestamp = new Date().toISOString();
  const message = {
    type: 'complaint:new',
    payload: complaint,
    timestamp
  };

  const shopId = complaint.shopId?._id || complaint.shopId;
  if (shopId) {
    const shopRoom = `shop:${shopId}`;
    ioInstance.to(shopRoom).emit('complaint:new', message);
    logger.info(`Emitted complaint:new to room ${shopRoom} for complaint ${complaint._id || complaint.referenceNumber}`);
  }

  // Also emit to admin room
  ioInstance.to('admin').emit('complaint:new', message);
};

/**
 * Emit complaint:update event to subscribed clients
 * Uses message format: { type, payload, timestamp } consistent with order events
 * **Feature: complaint-management, Property 26: WebSocket Notification Format**
 * **Validates: Requirements 8.2, 8.3**
 * 
 * @param {Object} complaint - Updated complaint object
 */
const emitComplaintUpdate = (complaint) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit complaint:update');
    return;
  }

  const timestamp = new Date().toISOString();
  const message = {
    type: 'complaint:update',
    payload: complaint,
    timestamp
  };

  const shopId = complaint.shopId?._id || complaint.shopId;
  if (shopId) {
    const shopRoom = `shop:${shopId}`;
    ioInstance.to(shopRoom).emit('complaint:update', message);
    logger.info(`Emitted complaint:update to room ${shopRoom} for complaint ${complaint._id || complaint.referenceNumber}`);
  }

  // Also emit to admin room
  ioInstance.to('admin').emit('complaint:update', message);
};

/**
 * Get the Socket.IO instance
 * @returns {Server|null} Socket.IO server instance
 */
const getIO = () => ioInstance;

module.exports = {
  setupComplaintEvents,
  emitComplaintNew,
  emitComplaintUpdate,
  getIO
};

/**
 * Emit complaint:created event when a complaint is created
 * Also updates the associated order's hasComplaint flag
 * 
 * @param {Object} complaint - Created complaint object
 * @param {string} orderId - Associated order ID
 */
const emitComplaintCreated = async (complaint, orderId) => {
  if (!ioInstance) {
    logger.warn('WebSocket not initialized, cannot emit complaint:created');
    return;
  }

  const timestamp = new Date().toISOString();
  const message = {
    type: 'complaint:created',
    payload: {
      orderId,
      complaintId: complaint._id,
      referenceNumber: complaint.referenceNumber
    },
    timestamp
  };

  const shopId = complaint.shopId?._id || complaint.shopId;
  if (shopId) {
    const shopRoom = `shop:${shopId}`;
    ioInstance.to(shopRoom).emit('complaint:created', message);
    logger.info(`Emitted complaint:created to room ${shopRoom} for order ${orderId}`);
  }

  // Also emit to admin room
  ioInstance.to('admin').emit('complaint:created', message);

  // Update order's hasComplaint flag
  try {
    const Order = require('../models/Order');
    await Order.updateOne(
      { _id: orderId },
      { $set: { hasComplaint: true } }
    );
  } catch (error) {
    logger.error('Error updating order hasComplaint flag:', error);
  }
};

module.exports = {
  setupComplaintEvents,
  emitComplaintNew,
  emitComplaintUpdate,
  emitComplaintCreated,
  getIO
};
