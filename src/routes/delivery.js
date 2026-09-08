const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const deliveryService = require('../services/deliveryService');
const DeliveryIntegration = require('../models/DeliveryIntegration');
const Order = require('../models/Order');

const {
  analyzeIntigoOrders,
  toPublicAnalysis,
  buildDryRunResult
} = require('../services/delivery/intigoShipmentService');

// Helper to verify order belongs to user's shop
const verifyOrderOwnership = async (orderId, user) => {
  const order = await Order.findById(orderId);
  if (!order) return { valid: false, error: 'Order not found', status: 404 };
  
  if (user.role !== 'admin' && order.shopId.toString() !== user.shopId?.toString()) {
    return { valid: false, error: 'Access denied', status: 403 };
  }
  return { valid: true, order };
};

const serializeIntegration = integration => {
  const value =
    integration && typeof integration.toObject === 'function'
      ? integration.toObject()
      : integration || {};

  const credentials = value.credentials || {};

  return {
    _id: value._id,
    shopId: value.shopId,
    platform: value.platform,
    settings: value.settings || {},
    isActive: value.isActive,
    credentialsConfigured: Boolean(
      credentials.apiKey ||
      credentials.apiSecret ||
      credentials.username ||
      credentials.password ||
      credentials.accountNumber
    ),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
};

// Setup delivery integration
router.post(
  '/integration',
  auth,
  authorize('shop_owner'),
  async (req, res, next) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'No shop associated with user' });
    }
    
    const { platform, credentials, settings } = req.body;
    const integration = await deliveryService.setupDeliveryIntegration(
      req.user.shopId,
      platform,
      credentials,
      settings
    );
    res.status(201).json(
      serializeIntegration(integration)
    );
  } catch (error) {
    next(error);
  }
});

// Get delivery integrations
router.get(
  '/integrations',
  auth,
  authorize('shop_owner'),
  async (req, res, next) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'No shop associated with user' });
    }
    
    const integrations = await DeliveryIntegration.find({
      shopId: req.user.shopId
    });

    res.json(
      integrations.map(serializeIntegration)
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/delivery/intigo/preview
 *
 * Pré-valide les commandes sélectionnées.
 * Aucun colis Intigo n'est créé.
 */
router.post(
  '/intigo/preview',
  auth,
  authorize('shop_owner'),
  async (req, res, next) => {
    try {
      if (!req.user.shopId) {
        return res.status(400).json({
          error:
            'No shop associated with user'
        });
      }

      const analysis =
        await analyzeIntigoOrders({
          shopId:
            req.user.shopId,

          orderIds:
            req.body?.orderIds
        });

      const result =
        toPublicAnalysis(
          analysis
        );

      return res.json({
        success: true,
        provider: 'intigo',
        ...result
      });
    } catch (error) {
      if (error.statusCode) {
        return res
          .status(error.statusCode)
          .json({
            error:
              error.message,

            ...(error.invalidOrderIds
              ? {
                  invalidOrderIds:
                    error.invalidOrderIds
                }
              : {})
          });
      }

      next(error);
    }
  }
);

/**
 * POST /api/delivery/intigo/shipments
 *
 * Etape de sécurité actuelle :
 * SEUL dryRun=true est accepté.
 *
 * Aucun document DeliveryShipment n'est créé.
 * Aucun POST n'est envoyé à Intigo.
 *
 * Body:
 * {
 *   "orderIds": ["..."],
 *   "dryRun": true,
 *   "allowReview": false
 * }
 */
router.post(
  '/intigo/shipments',
  auth,
  authorize('shop_owner'),
  async (req, res, next) => {
    try {
      if (!req.user.shopId) {
        return res.status(400).json({
          error:
            'No shop associated with user'
        });
      }

      const {
        orderIds,
        dryRun,
        allowReview = false
      } = req.body || {};

      /*
       * Hard safety gate.
       *
       * Tant que la vraie création Intigo
       * n'est pas implémentée et validée,
       * toute tentative dryRun=false échoue.
       */
      if (dryRun !== true) {
        return res.status(409).json({
          success: false,
          provider: 'intigo',
          error:
            'Real Intigo shipment creation is currently disabled. Use dryRun=true.'
        });
      }

      if (
        typeof allowReview !==
        'boolean'
      ) {
        return res.status(400).json({
          error:
            'allowReview must be a boolean'
        });
      }

      const analysis =
        await analyzeIntigoOrders({
          shopId:
            req.user.shopId,

          orderIds
        });

      const result =
        buildDryRunResult({
          analysis,
          allowReview
        });

      return res.json(
        result
      );
    } catch (error) {
      if (error.statusCode) {
        return res
          .status(error.statusCode)
          .json({
            error:
              error.message,

            ...(error.invalidOrderIds
              ? {
                  invalidOrderIds:
                    error.invalidOrderIds
                }
              : {})
          });
      }

      next(error);
    }
  }
);

// Create shipment
router.post('/shipment/:orderId', auth, async (req, res, next) => {
  try {
    const ownership = await verifyOrderOwnership(req.params.orderId, req.user);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }
    
    const trackingNumber = await deliveryService.createAramexShipment(req.params.orderId);
    res.json({ trackingNumber });
  } catch (error) {
    next(error);
  }
});

// Track shipment
router.get('/track/:orderId', auth, async (req, res, next) => {
  try {
    const ownership = await verifyOrderOwnership(req.params.orderId, req.user);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }
    
    const trackingInfo = await deliveryService.trackShipment(req.params.orderId);
    res.json(trackingInfo);
  } catch (error) {
    next(error);
  }
});

module.exports = router;