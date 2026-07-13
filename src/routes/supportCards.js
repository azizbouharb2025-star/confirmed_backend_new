const express = require('express');
const { auth } = require('../middleware/auth');
const { tierMeetsMinimum, getUserTier } = require('../middleware/tierCheck');
const { validate, complaintSchemas } = require('../middleware/complaintValidation');
const supportCardService = require('../services/supportCardService');

const router = express.Router();

/**
 * Middleware to check if user has Pro+ tier access
 * **Validates: Requirements 1.1, 1.5**
 */
const requireProTier = async (req, res, next) => {
  try {
    const tier = await getUserTier(req.user);
    if (!tierMeetsMinimum(tier, 'pro')) {
      return res.status(403).json({
        error: 'Feature not available',
        code: 'TIER_RESTRICTION',
        details: {
          currentTier: tier,
          requiredTier: 'pro',
          message: 'Support card generation requires Pro tier or higher'
        }
      });
    }
    req.userTier = tier;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/support-cards/qr/:token
 * Serve QR code image for a token
 * 
 * @param {string} token - Support card token
 * @returns {image/png} QR code image
 */
router.get('/qr/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    // Verify token exists
    const tokenRecord = await supportCardService.getToken(token);
    if (!tokenRecord) {
      return res.status(404).json({
        error: 'Token not found',
        code: 'TOKEN_NOT_FOUND'
      });
    }

    // Generate QR code buffer
    const buffer = await supportCardService.generateQRCodeBuffer(token);

    // Set headers for image response
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
    });

    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/support-cards/generate
 * Generate a single support card for an order
 * **Validates: Requirements 1.1, 1.2**
 * 
 * @body {string} orderId - Order ID (MongoDB _id or order number like ORD-001)
 * @returns {Object} Token data with token, qrCodeUrl, qrCodeBase64, expiresAt
 */
router.post('/generate', auth, requireProTier, async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const shopId = req.user.shopId;

    if (!orderId) {
      return res.status(400).json({
        error: 'orderId is required',
        code: 'MISSING_ORDER_ID'
      });
    }

    if (!shopId) {
      return res.status(400).json({
        error: 'Shop ID not found for user',
        code: 'SHOP_NOT_FOUND'
      });
    }

    const result = await supportCardService.generateToken(orderId, shopId);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/support-cards/generate-bulk
 * Generate support cards for multiple orders
 * **Validates: Requirements 1.5**
 * 
 * @body {string[]} orderIds - Array of Order IDs
 * @returns {Object} Bulk generation results with successful and failed tokens
 */
router.post(
  '/generate-bulk',
  auth,
  requireProTier,
  validate(complaintSchemas.bulkSupportCards),
  async (req, res, next) => {
    try {
      const { orderIds } = req.body;
      const shopId = req.user.shopId;

      if (!shopId) {
        return res.status(400).json({
          error: 'Shop ID not found for user',
          code: 'SHOP_NOT_FOUND'
        });
      }

      const result = await supportCardService.generateBulkTokens(orderIds, shopId);

      res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/support-cards/bulk
 * Generate support cards for multiple orders (alias)
 * **Validates: Requirements 1.5**
 * 
 * @body {string[]} orderIds - Array of Order IDs
 * @returns {Object} Bulk generation results with successful and failed tokens
 */
router.post(
  '/bulk',
  auth,
  requireProTier,
  validate(complaintSchemas.bulkSupportCards),
  async (req, res, next) => {
    try {
      const { orderIds } = req.body;
      const shopId = req.user.shopId;

      if (!shopId) {
        return res.status(400).json({
          error: 'Shop ID not found for user',
          code: 'SHOP_NOT_FOUND'
        });
      }

      const result = await supportCardService.generateBulkTokens(orderIds, shopId);

      res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/support-cards/:orderId
 * Generate a single support card for an order
 * **Validates: Requirements 1.1, 1.2**
 * 
 * @param {string} orderId - Order ID (MongoDB _id)
 * @returns {Object} Token data with token, qrCodeUrl, qrCodeBase64, expiresAt
 */
router.post('/:orderId', auth, requireProTier, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const shopId = req.user.shopId;

    if (!shopId) {
      return res.status(400).json({
        error: 'Shop ID not found for user',
        code: 'SHOP_NOT_FOUND'
      });
    }

    const result = await supportCardService.generateToken(orderId, shopId);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

module.exports = router;
