const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const deliveryService = require('../services/deliveryService');
const DeliveryIntegration = require('../models/DeliveryIntegration');
const Order = require('../models/Order');
const DeliveryShipment = require('../models/DeliveryShipment');
const mongoose = require('mongoose');
const intigoClient = require('../services/delivery/intigoClient');
const { mapOrderToIntigo } = require('../services/delivery/intigoMapper');

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
 * Pré-valide les commandes sélectionnées avant tout envoi vers Intigo.
 * Aucun colis n'est créé par cette route.
 *
 * Body:
 * {
 *   "orderIds": ["<mongodb-id>", "..."]
 * }
 */
router.post(
  '/intigo/preview',
  auth,
  authorize('shop_owner'),
  async (req, res, next) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({
        error: 'No shop associated with user'
      });
    }

    const { orderIds } = req.body;

    if (
      !Array.isArray(orderIds) ||
      orderIds.length === 0
    ) {
      return res.status(400).json({
        error: 'orderIds must contain at least one order'
      });
    }

    if (orderIds.length > 100) {
      return res.status(400).json({
        error: 'Maximum 100 orders per Intigo preview'
      });
    }

    const normalizedIds = [
      ...new Set(
        orderIds.map(id => String(id).trim())
      )
    ];

    const malformedIds = normalizedIds.filter(
      id => !mongoose.Types.ObjectId.isValid(id)
    );

    if (malformedIds.length > 0) {
      return res.status(400).json({
        error: 'Invalid MongoDB order IDs',
        invalidOrderIds: malformedIds
      });
    }

    const orders = await Order.find({
      _id: {
        $in: normalizedIds
      },
      shopId: req.user.shopId
    }).lean();

    const orderById = new Map(
      orders.map(order => [
        String(order._id),
        order
      ])
    );

    const ready = [];
    const review = [];
    const duplicate = [];
    const invalid = [];

    const existingShipments =
      await DeliveryShipment.find({
        orderId: {
          $in: normalizedIds
        },
        provider: 'intigo'
      })
        .select({
          orderId: 1,
          correlationId: 1,
          externalId: 1,
          state: 1,
          updatedAt: 1
        })
        .lean();

    const shipmentByOrderId = new Map(
      existingShipments.map(shipment => [
        String(shipment.orderId),
        shipment
      ])
    );

    for (const requestedId of normalizedIds) {
      const order = orderById.get(requestedId);

      if (!order) {
        invalid.push({
          orderId: requestedId,
          confirmedId: null,
          errors: [
            'Commande introuvable ou hors de cette boutique'
          ]
        });

        continue;
      }

      const existingShipment =
        shipmentByOrderId.get(requestedId);

      if (
        existingShipment &&
        ['preparing', 'created'].includes(
          existingShipment.state
        )
      ) {
        duplicate.push({
          orderId: requestedId,
          confirmedId: order.confirmedId,
          state: existingShipment.state,
          correlationId:
            existingShipment.correlationId || null,
          externalId:
            existingShipment.externalId || null
        });

        continue;
      }

      const {
        payload,
        errors
      } = mapOrderToIntigo(order);

      if (errors.length > 0) {
        invalid.push({
          orderId: requestedId,
          confirmedId: order.confirmedId,
          errors
        });

        continue;
      }

      const location =
        await intigoClient.resolveLocation(
          payload.city_name,
          payload.district_name
        );

      if (!location.valid) {
        invalid.push({
          orderId: requestedId,
          confirmedId: order.confirmedId,
          errors: [location.error]
        });

        continue;
      }

      const previewItem = {
        orderId: requestedId,
        confirmedId: order.confirmedId,
        cid: payload.cid,
        city_name: location.city.name,
        district_name:
          location.district?.name ||
          payload.district_name ||
          null,
        districtResolved: Boolean(location.district),
        price: payload.price,
        itemCount: Array.isArray(order.items)
          ? order.items.length
          : 0,
        warnings: location.warning
          ? [location.warning]
          : []
      };

      if (location.warning) {
        review.push(previewItem);
        continue;
      }

      ready.push(previewItem);
    }

    const integration =
      await DeliveryIntegration.findOne({
        shopId: req.user.shopId,
        platform: 'intigo',
        isActive: true
      }).lean();

    const pickupIndex =
      integration?.settings?.pickupIndex;

    const integrationReady = Boolean(
      integration &&
      integration.credentials?.apiKey &&
      Number.isInteger(pickupIndex)
    );

    return res.json({
      success: true,
      provider: 'intigo',

      integration: {
        configured: Boolean(integration),
        ready: integrationReady,
        pickupIndex:
          Number.isInteger(pickupIndex)
            ? pickupIndex
            : null
      },

      summary: {
        selected: normalizedIds.length,
        ready: ready.length,
        review: review.length,
        duplicate: duplicate.length,
        invalid: invalid.length
      },

      ready,
      review,
      duplicate,
      invalid
    });
  } catch (error) {
    next(error);
  }
});

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