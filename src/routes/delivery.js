const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const deliveryService = require('../services/deliveryService');
const DeliveryIntegration = require('../models/DeliveryIntegration');
const DeliveryShipment = require('../models/DeliveryShipment');
const Order = require('../models/Order');

const {
  analyzeIntigoOrders,
  toPublicAnalysis,
  buildDryRunResult,
  reserveIntigoShipments,
  isActivePreparingShipment,
  buildIntigoDispatchPreview,
  dispatchIntigoReservation
} = require('../services/delivery/intigoShipmentService');

const {
  getIntigoShipmentStatusPreview,
  syncIntigoShipmentStatus
} = require('../services/delivery/intigoStatusService');

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
 * GET /api/delivery/intigo/capabilities
 *
 * Capacités publiques de l'intégration Intigo
 * pour le commerçant authentifié.
 *
 * IMPORTANT :
 * - aucun appel Intigo
 * - aucune lecture/écriture MongoDB
 * - aucune mutation distante
 *
 * Le vrai verrou reste aussi appliqué
 * dans dispatchIntigoReservation().
 */
router.get(
  '/intigo/capabilities',
  auth,
  authorize('shop_owner'),
  async (req, res) => {
    if (!req.user.shopId) {
      return res.status(400).json({
        error:
          'No shop associated with user'
      });
    }

    return res.json({
      success: true,

      provider:
        'intigo',

      liveDispatchEnabled:
        process.env.INTIGO_LIVE_DISPATCH_ENABLED ===
        'true',

      requiresExplicitConfirmation:
        true,

      maxLiveOrdersPerDispatch:
        1,

      remoteCallPerformed:
        false
    });
  }
);

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
 * POST /api/delivery/intigo/reservations
 *
 * Réservation LOCALE uniquement.
 *
 * - écrit DeliveryShipment(state=preparing)
 * - aucune création chez Intigo
 * - aucun appel POST Intigo
 */
router.post(
  '/intigo/reservations',
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
        allowReview = false
      } = req.body || {};

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
        await reserveIntigoShipments({
          shopId:
            req.user.shopId,

          userId:
            req.user._id,

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

/**
 * GET /api/delivery/intigo/reservations/:orderId
 *
 * Reprend une réservation LOCALE Intigo encore active.
 *
 * IMPORTANT :
 * - lecture MongoDB uniquement
 * - aucun appel Intigo
 * - aucune mutation MongoDB
 * - ne crée aucune nouvelle réservation
 */
router.get(
  '/intigo/reservations/:orderId',
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

      const ownership =
        await verifyOrderOwnership(
          req.params.orderId,
          req.user
        );

      if (!ownership.valid) {
        return res
          .status(ownership.status)
          .json({
            error:
              ownership.error
          });
      }

      const shipment =
        await DeliveryShipment.findOne({
          orderId:
            req.params.orderId,

          shopId:
            req.user.shopId,

          provider:
            'intigo'
        })
          .select({
            state:
              1,

            externalId:
              1,

            correlationId:
              1,

            reservationId:
              1,

            reservedAt:
              1,

            reservationExpiresAt:
              1
          })
          .lean();

      if (
        !shipment ||
        !isActivePreparingShipment(
          shipment
        )
      ) {
        return res.status(409).json({
          success:
            false,

          provider:
            'intigo',

          error:
            'No active Intigo preparation exists for this order'
        });
      }

      if (!shipment.reservationId) {
        return res.status(409).json({
          success:
            false,

          provider:
            'intigo',

          error:
            'Active Intigo preparation has no reservation identifier'
        });
      }

      return res.json({
        success:
          true,

        provider:
          'intigo',

        orderId:
          req.params.orderId,

        state:
          shipment.state,

        correlationId:
          shipment.correlationId ||
          null,

        reservationId:
          shipment.reservationId,

        reservedAt:
          shipment.reservedAt ||
          null,

        reservationExpiresAt:
          shipment.reservationExpiresAt ||
          null,

        externalId:
          shipment.externalId ||
          null,

        remoteCallPerformed:
          false,

        databaseMutationPerformed:
          false
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/delivery/intigo/dispatch-preview
 *
 * Dernier contrôle avant envoi réel.
 *
 * - aucune requête POST Intigo
 * - aucun changement d'état MongoDB
 * - reconstruit le payload final
 * - retourne uniquement des données non sensibles
 */
router.post(
  '/intigo/dispatch-preview',
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

      const result =
        await buildIntigoDispatchPreview({
          shopId:
            req.user.shopId,

          reservationId:
            req.body?.reservationId
        });

      return res.json(
        result
      );
    } catch (error) {
      if (error.statusCode) {
        return res
          .status(
            error.statusCode
          )
          .json({
            success: false,
            provider:
              'intigo',
            error:
              error.message
          });
      }

      next(error);
    }
  }
);

/**
 * POST /api/delivery/intigo/dispatch
 *
 * LIVE endpoint.
 *
 * Protections :
 * - shop_owner
 * - feature flag serveur
 * - une seule réservation
 * - réservation non expirée
 * - confirm=true
 * - correlationId exact
 * - hash SHA-256 exact
 */
router.post(
  '/intigo/dispatch',
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

      const result =
        await dispatchIntigoReservation({
          shopId:
            req.user.shopId,

          reservationId:
            req.body?.reservationId,

          expectedCorrelationId:
            req.body?.expectedCorrelationId,

          expectedPayloadHash:
            req.body?.expectedPayloadHash,

          confirm:
            req.body?.confirm
        });

      return res.status(201).json(
        result
      );
    } catch (error) {
      if (
        error.statusCode ||
        error.remoteCreated
      ) {
        return res
          .status(
            error.statusCode ||
            500
          )
          .json({
            success:
              false,

            provider:
              'intigo',

            error:
              error.message,

            ...(error.liveDispatchDisabled
              ? {
                  liveDispatchDisabled:
                    true
                }
              : {}),

            ...(error.shipmentState
              ? {
                  shipmentState:
                    error.shipmentState
                }
              : {}),

            ...(error.remoteCreated
              ? {
                  remoteCreated:
                    true,

                  nid:
                    error.nid ||
                    null
                }
              : {})
          });
      }

      next(error);
    }
  }
);

/**
 * GET /api/delivery/shipments/:orderId/tracking
 *
 * Tracking local générique.
 *
 * IMPORTANT :
 * - lit uniquement MongoDB
 * - aucun appel API transporteur
 * - aucune mutation distante
 * - aucune mutation locale
 * - ne contient aucune règle spécifique Intigo
 */
router.get(
  '/shipments/:orderId/tracking',
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

      const ownership =
        await verifyOrderOwnership(
          req.params.orderId,
          req.user
        );

      if (!ownership.valid) {
        return res
          .status(ownership.status)
          .json({
            error:
              ownership.error
          });
      }

      const shipments =
        await DeliveryShipment.find({
          orderId:
            req.params.orderId,

          shopId:
            req.user.shopId,

          externalId: {
            $exists:
              true,

            $nin: [
              null,
              ''
            ]
          }
        })
          .sort({
            updatedAt:
              -1
          })
          .select({
            provider:
              1,

            state:
              1,

            correlationId:
              1,

            externalId:
              1,

            providerStatusCode:
              1,

            providerStatusLabel:
              1,

            metadata:
              1,

            createdAt:
              1,

            updatedAt:
              1
          })
          .lean();

      const tracking =
        shipments.map(
          shipment => ({
            shipmentId:
              shipment._id,

            provider:
              shipment.provider,

            state:
              shipment.state,

            correlationId:
              shipment.correlationId ||
              null,

            trackingNumber:
              shipment.externalId ||
              null,

            providerStatusCode:
              shipment.providerStatusCode ??
              null,

            providerStatusLabel:
              shipment.providerStatusLabel ||
              null,

            lastSyncedAt:
              shipment.metadata
                ?.lastStatusSyncAt ||
              null,

            createdAt:
              shipment.createdAt,

            updatedAt:
              shipment.updatedAt
          })
        );

      return res.json({
        success:
          true,

        orderId:
          req.params.orderId,

        remoteCallPerformed:
          false,

        tracking
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * GET /api/delivery/intigo/shipments/:orderId/status
 *
 * Lecture seule :
 * - GET distant Intigo
 * - aucun changement Order
 * - aucun changement DeliveryShipment
 * - retourne seulement le mapping proposé
 */
router.get(
  '/intigo/shipments/:orderId/status',
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

      const result =
        await getIntigoShipmentStatusPreview({
          shopId:
            req.user.shopId,

          orderId:
            req.params.orderId
        });

      return res.json(
        result
      );
    } catch (error) {
      if (error.statusCode) {
        return res
          .status(
            error.statusCode
          )
          .json({
            success:
              false,

            provider:
              'intigo',

            error:
              error.message
          });
      }

      next(error);
    }
  }
);

/**
 * POST /api/delivery/intigo/shipments/:orderId/sync
 *
 * Synchronisation explicite :
 * - GET chez Intigo
 * - mémorise providerStatus
 * - peut avancer Order selon mapping sécurisé
 * - aucun changement distant Intigo
 */
router.post(
  '/intigo/shipments/:orderId/sync',
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

      const result =
        await syncIntigoShipmentStatus({
          shopId:
            req.user.shopId,

          orderId:
            req.params.orderId
        });

      return res.json(
        result
      );
    } catch (error) {
      if (error.statusCode) {
        return res
          .status(
            error.statusCode
          )
          .json({
            success:
              false,

            provider:
              'intigo',

            error:
              error.message
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