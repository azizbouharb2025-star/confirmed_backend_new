const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * WebSocket authentication middleware
 * Verifies JWT token on connection and attaches user to socket instance
 * **Feature: orders-api-enhancement, Property 28: WebSocket Authentication**
 * **Validates: Requirements 11.4**
 * 
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Function} next - Next middleware function
 */
const authenticateSocket = async (socket, next) => {
  try {
    // Get token from handshake auth or query
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      logger.warn('WebSocket connection rejected: No token provided');
      return next(new Error('Authentication error: No token provided'));
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      logger.warn('WebSocket connection rejected: Invalid token');
      return next(new Error('Authentication error: Invalid token'));
    }

    // Find user
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      logger.warn('WebSocket connection rejected: User not found');
      return next(new Error('Authentication error: User not found'));
    }

    // Attach user to socket
    socket.user = user;
    
    logger.info(`WebSocket authenticated for user: ${user._id}`);
    next();
  } catch (error) {
    logger.error('WebSocket authentication error:', error);
    next(new Error('Authentication error: Server error'));
  }
};

module.exports = { authenticateSocket };
