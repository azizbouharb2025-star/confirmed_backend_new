const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const SupportCardToken = require('../models/SupportCardToken');
const Order = require('../models/Order');
const logger = require('../utils/logger');

/**
 * Support Card Service
 * Handles QR support card generation and validation for complaint submission
 */
class SupportCardService {
  /**
   * Generate a single support card token for an order
   * **Validates: Requirements 1.1, 1.3**
   * 
   * @param {string} orderId - Order ID (MongoDB _id)
   * @param {string} shopId - Shop ID (MongoDB _id)
   * @returns {Promise<Object>} Token data with token, qrCodeUrl, qrCodeBase64, expiresAt
   */
  async generateToken(orderId, shopId) {
    // Verify order exists and belongs to shop
    // Support both MongoDB _id and orderId field (e.g., "ORD-001")
    let order;
    if (orderId.match(/^[0-9a-fA-F]{24}$/)) {
      // Looks like a MongoDB ObjectId
      order = await Order.findById(orderId);
    } else {
      // Assume it's an orderId field value
      order = await Order.findOne({ orderId: orderId });
    }
    
    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }

    if (order.shopId.toString() !== shopId.toString()) {
      const error = new Error('Order does not belong to this shop');
      error.statusCode = 403;
      error.code = 'ACCESS_DENIED';
      throw error;
    }

    // Generate unique token
    const token = uuidv4();

    // Calculate 90-day expiry
    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + 90);

    // Save token to database - use the actual MongoDB _id
    const supportCardToken = new SupportCardToken({
      token,
      orderId: order._id,
      shopId,
      expiresAt,
      used: false
    });

    await supportCardToken.save();

    // Generate QR code
    const { qrCodeUrl, qrCodeBase64 } = await this._generateQRCode(token);

    logger.info(`Support card token generated for order ${order.orderId}`, { token, shopId });

    return {
      token,
      orderId: order._id,
      orderNumber: order.orderId,
      shopId,
      qrCodeUrl,
      qrCodeBase64,
      expiresAt,
      createdAt: supportCardToken.createdAt
    };
  }


  /**
   * Generate tokens for multiple orders
   * **Validates: Requirements 1.5**
   * 
   * @param {string[]} orderIds - Array of Order IDs
   * @param {string} shopId - Shop ID
   * @returns {Promise<Array>} Array of token data objects
   */
  async generateBulkTokens(orderIds, shopId) {
    const results = [];
    const errors = [];

    for (const orderId of orderIds) {
      try {
        const tokenData = await this.generateToken(orderId, shopId);
        results.push({
          orderId,
          ...tokenData,
          success: true
        });
      } catch (error) {
        logger.error(`Failed to generate token for order ${orderId}:`, error);
        errors.push({
          orderId,
          success: false,
          error: error.message,
          code: error.code || 'GENERATION_FAILED'
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      totalRequested: orderIds.length,
      totalSuccessful: results.length,
      totalFailed: errors.length
    };
  }

  /**
   * Validate a token and return order context
   * **Validates: Requirements 1.4, 2.1**
   * 
   * @param {string} token - Support card token
   * @returns {Promise<Object>} Validation result with order context
   */
  async validateToken(token) {
    // Find token in database
    const supportCardToken = await SupportCardToken.findOne({ token });

    if (!supportCardToken) {
      return {
        valid: false,
        error: 'Token not found',
        code: 'TOKEN_INVALID'
      };
    }

    // Check if token has expired
    if (new Date() > supportCardToken.expiresAt) {
      return {
        valid: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      };
    }

    // Check if token has already been used
    if (supportCardToken.used) {
      return {
        valid: false,
        error: 'Token has already been used',
        code: 'TOKEN_USED'
      };
    }

    // Get order with customer and item details
    const order = await Order.findById(supportCardToken.orderId)
      .populate('items.productId', 'name price')
      .populate('shopId', 'name domain');

    if (!order) {
      return {
        valid: false,
        error: 'Associated order not found',
        code: 'ORDER_NOT_FOUND'
      };
    }

    return {
      valid: true,
      tokenId: supportCardToken._id,
      orderId: order._id,
      shopId: supportCardToken.shopId,
      order: {
        _id: order._id,
        orderId: order.orderId,
        clientInfo: order.clientInfo,
        items: order.items,
        totalAmount: order.totalAmount,
        status: order.status,
        region: order.region,
        shop: order.shopId,
        createdAt: order.createdAt
      }
    };
  }


  /**
   * Mark token as used
   * **Validates: Requirements 1.1**
   * 
   * @param {string} token - Support card token
   * @returns {Promise<Object>} Updated token record
   */
  async markTokenUsed(token) {
    const supportCardToken = await SupportCardToken.findOneAndUpdate(
      { token },
      {
        used: true,
        usedAt: new Date()
      },
      { new: true }
    );

    if (!supportCardToken) {
      const error = new Error('Token not found');
      error.statusCode = 404;
      error.code = 'TOKEN_INVALID';
      throw error;
    }

    logger.info(`Support card token marked as used: ${token}`);

    return supportCardToken;
  }

  /**
   * Generate QR code for a token
   * **Validates: Requirements 1.2**
   * 
   * @param {string} token - Support card token
   * @returns {Promise<Object>} QR code URL and base64 image
   * @private
   */
  async _generateQRCode(token) {
    const baseUrl = process.env.BASE_URL || 'https://confirmed.tn';
    const qrCodeUrl = `${baseUrl}/complaints/form/${token}`;

    try {
      // Generate base64 encoded QR code image
      const qrCodeBase64 = await QRCode.toDataURL(qrCodeUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2
      });

      return {
        qrCodeUrl,
        qrCodeBase64
      };
    } catch (error) {
      logger.error('Failed to generate QR code:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate QR code buffer for serving as image
   * 
   * @param {string} token - Support card token
   * @returns {Promise<Buffer>} QR code image buffer
   */
  async generateQRCodeBuffer(token) {
    const baseUrl = process.env.BASE_URL || 'https://confirmed.tn';
    const complaintFormUrl = `${baseUrl}/complaints/form/${token}`;

    try {
      const buffer = await QRCode.toBuffer(complaintFormUrl, {
        errorCorrectionLevel: 'M',
        type: 'png',
        width: 300,
        margin: 2
      });
      return buffer;
    } catch (error) {
      logger.error('Failed to generate QR code buffer:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Get token by token string (for internal use)
   * 
   * @param {string} token - Support card token
   * @returns {Promise<Object>} Token record
   */
  async getToken(token) {
    return SupportCardToken.findOne({ token });
  }

  /**
   * Get all tokens for an order
   * 
   * @param {string} orderId - Order ID
   * @returns {Promise<Array>} Array of token records
   */
  async getTokensByOrder(orderId) {
    return SupportCardToken.find({ orderId }).sort({ createdAt: -1 });
  }

  /**
   * Get all tokens for a shop
   * 
   * @param {string} shopId - Shop ID
   * @param {Object} options - Query options (page, limit)
   * @returns {Promise<Object>} Paginated token records
   */
  async getTokensByShop(shopId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const [tokens, total] = await Promise.all([
      SupportCardToken.find({ shopId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('orderId', 'orderId clientInfo.name'),
      SupportCardToken.countDocuments({ shopId })
    ]);

    return {
      tokens,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }
}

module.exports = new SupportCardService();
