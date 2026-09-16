const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ImportHistory = require('../models/ImportHistory');
const ExportTemplate = require('../models/ExportTemplate');
const { auth, authorize } = require('../middleware/auth');
const { getRedisClient } = require('../config/redis');
const orderService = require('../services/orderService');
const exportService = require('../services/exportService');
const importService = require('../services/importService');
const { applyTierFilters } = require('../middleware/tierCheck');

// Multer memory storage for file imports (max 50 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
      'application/csv',
      'application/octet-stream'
    ];
    const ext = (file.originalname || '').toLowerCase();
    if (allowed.includes(file.mimetype) || ext.endsWith('.xlsx') || ext.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers XLSX et CSV sont acceptés'));
    }
  }
});

const router = express.Router();

const createOrderSchema = Joi.object({
  orderId: Joi.string().allow('').optional(),
  clientInfo: Joi.object({
    name: Joi.string().required(),
    phone: Joi.string().required(),
    additionalPhones: Joi.array().items(
      Joi.string().trim()
    ),
    email: Joi.string().email(),
    address: Joi.object({
      street: Joi.string(),
      city: Joi.string(),
      state: Joi.string(),
      district: Joi.string(),
      zipCode: Joi.string(),
      country: Joi.string()
    })
  }).required(),
  items: Joi.array()
    .items(
      Joi.object({
        productId: Joi.string().hex().length(24).required(),
        quantity: Joi.number().integer().min(1).required(),
        price: Joi.number().min(0).required()
      })
    )
    .min(1)
    .required(),
  deliveryFee: Joi.number().min(0),
  // Le frontend peut encore envoyer totalAmount pour compatibilité,
  // mais la valeur n'est jamais utilisée comme source de vérité.
  totalAmount: Joi.number().min(0).optional(),
  deliveryInfo: Joi.object({
    estimatedDate: Joi.date(),
    trackingNumber: Joi.string(),
    carrier: Joi.string(),
    secondaryPhone: Joi.string(),
    packageCount: Joi.number().integer().min(1),
    comment: Joi.string(),
    weight: Joi.number().min(0),
    colissimoType: Joi.string().valid(
      'VO', 'VM', 'GV', 'EXP',
      'FIX', 'ONP', 'BLK', 'SMD'
    )
  })
});


/**
 * Données que l'opérateur peut corriger directement
 * depuis son espace de travail.
 *
 * Le totalAmount n'est volontairement PAS accepté :
 * il est recalculé côté serveur.
 */
const operatorDetailsSchema = Joi.object({
  clientInfo: Joi.object({
    name: Joi.string().trim().min(1),
    phone: Joi.string().trim().min(1),

    email: Joi.string()
      .email()
      .allow('')
      .trim(),

    additionalPhones: Joi.array()
      .items(Joi.string().trim().min(1))
      .max(10),

    address: Joi.object({
      street: Joi.string().allow('').trim(),
      city: Joi.string().allow('').trim(),

      // state = gouvernorat dans le modèle actuel
      state: Joi.string().allow('').trim(),

      district: Joi.string().allow('').trim(),
      zipCode: Joi.string().allow('').trim(),
      country: Joi.string().allow('').trim()
    }).min(1)
  }).min(1),

  items: Joi.array()
    .items(
      Joi.object({
        _id: Joi.string().required(),

        // Permet à l'opérateur de changer le produit
        // lorsqu'un produit catalogue est disponible.
        productId: Joi.string().allow('', null),

        // Utile pour les anciennes commandes/imports
        // qui ne sont pas reliées au catalogue.
        name: Joi.string().trim().min(1),

        quantity: Joi.number()
          .integer()
          .min(1),

        price: Joi.number()
          .min(0)
      }).or('productId', 'name', 'quantity', 'price')
    )
    .min(1),

  deliveryFee: Joi.number()
    .min(0)
}).min(1);


const operatorConfirmationSchema = Joi.object({
  toneSignals: Joi.array()
    .items(
      Joi.string().valid(
        'polite',
        'confident',
        'enthusiastic',
        'quick_response',
        'hesitant',
        'distracted',
        'long_pauses',
        'rude',
        'aggressive',
        'nervous',
        'low_interest'
      )
    )
    .min(1)
    .max(3)
    .unique()
    .required(),

  confirmationLevel: Joi.string()
    .valid(
      'very_firm',
      'normal',
      'weak'
    )
    .required(),

  priceBehavior: Joi.string()
    .valid(
      'no_issue',
      'asks_discount',
      'insists_discount',
      'strong_negotiation'
    )
    .required(),

  productDoubts: Joi.string()
    .valid(
      'none',
      'asks_question',
      'multiple_doubts',
      'compares_seller'
    )
    .required(),

  deliveryInformation: Joi.string()
    .valid(
      'complete_quick',
      'clear_precise',
      'partial',
      'vague',
      'difficulty',
      'refuses_details'
    )
    .required(),

  engagementLevel: Joi.string()
    .valid(
      'very_engaged',
      'interested',
      'passive',
      'low_involvement',
      'distracted'
    )
    .required(),

  receptionIntent: Joi.string()
    .valid(
      'no_information',
      'wants_fast_delivery',
      'clearly_confirms_receipt',
      'asks_delivery_info',
      'uncertain_receipt',
      'does_not_know_when'
    )
    .required(),

  notes: Joi.string()
    .allow('')
    .max(1500)
    .optional(),

  // Durée réelle de l'appel en secondes.
  duration: Joi.number()
    .integer()
    .min(1)
    .max(21600)
    .optional()

});

const operatorPostponeSchema = Joi.object({
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),

  time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .allow('', null)
    .optional(),

  note: Joi.string()
    .allow('')
    .max(1000)
    .optional(),

  /*
   * JavaScript Date#getTimezoneOffset().
   * Exemple UTC+1 : -60.
   */
  timezoneOffsetMinutes: Joi.number()
    .integer()
    .min(-840)
    .max(840)
    .required()
});


const operatorCancellationSchema = Joi.object({
  reason: Joi.string()
    .valid(
      'customer_refused',
      'price_too_high',
      'quality_doubts',
      'duplicate_order',
      'fake_number',
      'not_available',
      'courier_failed',
      'customer_rejected_at_door'
    )
    .allow(null, '')
    .optional(),

  comment: Joi.string()
    .allow('')
    .max(1000)
    .optional()
});


const callAttemptSchema = Joi.object({
  attemptNumber: Joi.number()
    .integer()
    .valid(1, 2, 3)
    .required(),

  reason: Joi.string()
    .valid(
      'no_answer',
      'busy',
      'unreachable',
      'callback_requested',
      'interrupted',
      'other'
    )
    .allow(null, '')
    .optional(),

  notes: Joi.string()
    .allow('')
    .max(1000)
    .optional(),

  duration: Joi.number()
    .integer()
    .min(0)
    .optional()
});

const bulkStatusSchema = Joi.object({
  orderIds: Joi.array().items(Joi.string()).min(1).required(),
  status: Joi.string().valid('pending', 'assigned', 'in_progress', 'confirmed', 'rejected', 'cancelled', 'postponed', 'shipped', 'delivered', 'failed_delivery').required()
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

    // L'identifiant principal est généré exclusivement par CONFIRMED.
    // Toute valeur orderId/confirmedId envoyée par le formulaire manuel est ignorée.
    const {
      orderId: _ignoredOrderId,
      confirmedId: _ignoredConfirmedId,
      externalOrderId: _ignoredExternalOrderId,
      ...manualOrderData
    } = req.body;

    /*
     * Commande manuelle :
     * tous les articles doivent provenir du catalogue réel
     * de la boutique connectée.
     */
    const requestedItems = manualOrderData.items || [];

    const productIds = [
      ...new Set(
        requestedItems.map(item => item.productId)
      )
    ];

    const products = await Product.find({
      _id: {
        $in: productIds
      },
      shopId: req.user.shopId,
      isActive: true
    })
      .select(
        '_id name sku price deliveryFee imageUrl'
      )
      .lean();

    /*
     * Un productId inconnu ou appartenant à une autre
     * boutique doit bloquer la création.
     */
    if (products.length !== productIds.length) {
      return res.status(422).json({
        error:
          'Un ou plusieurs produits sont introuvables ou ne sont pas accessibles pour cette boutique.'
      });
    }

    const productsById = new Map(
      products.map(product => [
        product._id.toString(),
        product
      ])
    );

    const items = requestedItems.map(item => {
      const product =
        productsById.get(item.productId);

      return {
        productId: product._id,
        name: product.name,
        quantity: item.quantity,
        price: item.price,
        ...(product.sku && {
          sku: product.sku
        })
      };
    });

    /*
     * Une commande possède un seul deliveryFee.
     *
     * Par défaut on prend le frais catalogue le plus élevé
     * parmi les produits sélectionnés.
     *
     * La valeur envoyée manuellement par le vendeur reste
     * prioritaire lorsqu'il décide de la modifier.
     */
    const catalogDeliveryFee =
      requestedItems.length > 0
        ? Math.max(
            ...requestedItems.map(item => {
              const product =
                productsById.get(item.productId);

              return Number(
                product?.deliveryFee || 0
              );
            })
          )
        : 0;

    const deliveryFee =
      manualOrderData.deliveryFee !== undefined
        ? Number(manualOrderData.deliveryFee)
        : catalogDeliveryFee;

    /*
     * Le total envoyé par le navigateur n'est jamais
     * considéré comme fiable.
     */
    const itemsSubtotal = items.reduce(
      (sum, item) =>
        sum +
        Number(item.quantity) *
          Number(item.price),
      0
    );

    const totalAmount = Number(
      (
        itemsSubtotal +
        deliveryFee
      ).toFixed(3)
    );

    const governorate =
      manualOrderData.clientInfo?.address?.state?.trim() ||
      '';

    const order = await orderService.createOrder({
      ...manualOrderData,
      items,
      deliveryFee,
      totalAmount,
      ...(governorate && {
        region: governorate
      }),
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
    const requestedLimit = parseInt(req.query.limit, 10);

    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 20)
        : 5;

    const isAdmin =
      req.user.role === 'admin';

    const shopId =
      isAdmin
        ? null
        : req.user.shopId;

    if (
      !isAdmin &&
      !shopId
    ) {
      return res.json([]);
    }

    const query =
      shopId
        ? { shopId }
        : {};

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(
        'confirmedId orderId externalOrderId clientInfo.name clientInfo.phone items totalAmount status aiScore createdAt'
      )
      .populate('items.productId', 'name imageUrl')
      .lean();

    res.json(
      orders.map(order => ({
        _id: order._id,
        confirmedId: order.confirmedId,
        orderId: order.orderId,
        externalOrderId: order.externalOrderId,

        clientInfo: {
          name: order.clientInfo?.name || 'Client inconnu',
          phone: order.clientInfo?.phone || ''
        },

        items: order.items || [],
        totalAmount: order.totalAmount || 0,
        status: order.status,
        externalStatus: order.externalStatus || null,
        aiScore:
          typeof order.aiScore === 'number'
            ? order.aiScore
            : null,
        createdAt: order.createdAt
      }))
    );
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
 * POST /api/orders/:id/operator-actions/confirm
 *
 * Confirmation finale après saisie du Retour opérateur.
 */
router.post(
  '/:id/operator-actions/confirm',
  auth,
  authorize('operator'),
  async (req, res, next) => {
    try {
      const { error, value } =
        operatorConfirmationSchema.validate(
          req.body || {},
          {
            abortEarly: false,
            stripUnknown: true
          }
        );

      if (error) {
        return res.status(400).json({
          error:
            'Le retour opérateur est incomplet ou invalide.',
          details: error.details.map(
            detail => detail.message
          )
        });
      }

      const order =
        await orderService.confirmByOperator(
          req.params.id,
          value,
          req.user
        );

      res.json(order);
    } catch (error) {
      if (
        error.statusCode === 400 ||
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 409 ||
        error.statusCode === 422
      ) {
        return res.status(error.statusCode).json({
          error: error.message
        });
      }

      next(error);
    }
  }
);


/**
 * POST /api/orders/:id/operator-actions/postpone
 *
 * Reporter une commande.
 *
 * - date obligatoire
 * - heure facultative
 * - note facultative
 */
router.post(
  '/:id/operator-actions/postpone',
  auth,
  authorize('operator'),
  async (req, res, next) => {
    try {
      const { error, value } =
        operatorPostponeSchema.validate(
          req.body || {},
          {
            abortEarly: false,
            stripUnknown: true
          }
        );

      if (error) {
        return res.status(400).json({
          error: 'Données de report invalides.',
          details: error.details.map(
            detail => detail.message
          )
        });
      }

      const order =
        await orderService.postponeByOperator(
          req.params.id,
          value,
          req.user
        );

      res.json(order);
    } catch (error) {
      if (
        error.statusCode === 400 ||
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 409 ||
        error.statusCode === 422
      ) {
        return res.status(error.statusCode).json({
          error: error.message
        });
      }

      next(error);
    }
  }
);


/**
 * POST /api/orders/:id/operator-actions/cancel
 *
 * Annulation manuelle par un opérateur.
 *
 * - motif facultatif
 * - commentaire facultatif
 * - statut final : cancelled
 */
router.post(
  '/:id/operator-actions/cancel',
  auth,
  authorize('operator'),
  async (req, res, next) => {
    try {
      const { error, value } =
        operatorCancellationSchema.validate(
          req.body || {},
          {
            abortEarly: false,
            stripUnknown: true
          }
        );

      if (error) {
        return res.status(400).json({
          error: 'Données d’annulation invalides.',
          details: error.details.map(
            detail => detail.message
          )
        });
      }

      const order =
        await orderService.cancelByOperator(
          req.params.id,
          value,
          req.user
        );

      res.json(order);
    } catch (error) {
      if (
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 409
      ) {
        return res.status(error.statusCode).json({
          error: error.message
        });
      }

      next(error);
    }
  }
);


/**
 * POST /api/orders/:id/call-attempt
 *
 * Enregistre une tentative de contact.
 *
 * T1 / T2 :
 * - la commande reste dans la File d'attente
 *
 * T3 :
 * - la commande n'est PAS annulée immédiatement
 * - l'API indique au frontend qu'une confirmation
 *   d'annulation doit être demandée
 */
router.post(
  '/:id/call-attempt',
  auth,
  authorize('operator'),
  async (req, res, next) => {
    try {
      const { error, value } =
        callAttemptSchema.validate(req.body, {
          abortEarly: false,
          stripUnknown: true
        });

      if (error) {
        return res.status(400).json({
          error: 'Données de tentative invalides.',
          details: error.details.map(
            detail => detail.message
          )
        });
      }

      const result =
        await orderService.recordCallAttempt(
          req.params.id,
          value,
          req.user
        );

      res.json(result);
    } catch (error) {
      if (
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 409 ||
        error.statusCode === 422
      ) {
        return res.status(error.statusCode).json({
          error: error.message
        });
      }

      next(error);
    }
  }
);

/**
 * POST /api/orders/:id/call-attempt/confirm-cancellation
 *
 * Confirmation finale demandée après la Tentative 3.
 *
 * Aucune annulation automatique ne se produit avant
 * cet appel explicite du frontend.
 */
router.post(
  '/:id/call-attempt/confirm-cancellation',
  auth,
  authorize('operator'),
  async (req, res, next) => {
    try {
      const order =
        await orderService.confirmUnreachableCancellation(
          req.params.id,
          req.user
        );

      res.json(order);
    } catch (error) {
      if (
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 409
      ) {
        return res.status(error.statusCode).json({
          error: error.message
        });
      }

      next(error);
    }
  }
);


/**
 * PATCH /api/orders/:id/operator-details
 *
 * Modification des informations opérationnelles
 * pendant l'appel.
 *
 * Rôles :
 * - operator
 * - admin
 *
 * Le montant total est recalculé côté serveur.
 */
router.patch(
  '/:id/operator-details',
  auth,
  authorize('operator', 'admin', 'shop_owner'),
  async (req, res, next) => {
    try {
      const { error, value } = operatorDetailsSchema.validate(
        req.body,
        {
          abortEarly: false,
          stripUnknown: true
        }
      );

      if (error) {
        return res.status(400).json({
          error: 'Données de commande invalides.',
          details: error.details.map(detail => detail.message)
        });
      }

      const order = await orderService.updateOperatorDetails(
        req.params.id,
        value,
        req.user
      );

      res.json(order);
    } catch (error) {
      if (
        error.statusCode === 400 ||
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 409 ||
        error.statusCode === 422
      ) {
        return res.status(error.statusCode).json({
          error: error.message
        });
      }

      next(error);
    }
  }
);

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
    
    const validStatuses = ['pending', 'assigned', 'in_progress', 'confirmed', 'rejected', 'cancelled', 'postponed', 'shipped', 'delivered', 'failed_delivery'];
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

// ─── BULK IMPORT MODULE ────────────────────────────────────────────────────────

/**
 * POST /api/orders/import/preview
 * Step 1: Upload file and get AI column detection + validation preview (dry run).
 * Does NOT save anything to the database.
 * Body: multipart/form-data with field "file"
 */
router.post(
  '/import/preview',
  auth,
  authorize('shop_owner'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier reçu' });
      }

      const result = await importService.processImport(
        req.file.buffer,
        req.file.mimetype,
        {
          shopId: req.user.shopId,
          userId: req.user._id,
          fileName: req.file.originalname,
          duplicateAction: req.body.duplicateAction || 'ignore',
          dryRun: true,
          Order,
          ImportHistory
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/orders/import/confirm
 * Step 2: Actually import the orders after preview confirmation.
 * Body: multipart/form-data with field "file" + optional duplicateAction
 */
router.post(
  '/import/confirm',
  auth,
  authorize('shop_owner'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier reçu' });
      }

      const result = await importService.processImport(
        req.file.buffer,
        req.file.mimetype,
        {
          shopId: req.user.shopId,
          userId: req.user._id,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          duplicateAction: req.body.duplicateAction || 'ignore',
          dryRun: false,
          Order,
          ImportHistory
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/orders/import/history
 * Return paginated import history.
 *
 * Permissions:
 *   shop_owner  — sees only their own shop's history (enforced by req.user.shopId)
 *   admin       — may pass ?shopId=<id> to filter by shop, or omit to see all
 *   operator    — forbidden (403)
 *
 * Query params:
 *   page  (default 1)
 *   limit (default 10, max 100)
 *   shopId (admin only — ignored for shop_owner)
 */
router.get('/import/history', auth, async (req, res, next) => {
  try {
    const { role, shopId: userShopId } = req.user;

    // Operators have no access to import history
    if (role === 'operator') {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }

    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip  = (page - 1) * limit;

    // Build the query scope — shop_owner is always restricted to their own shop
    const query = {};
    if (role === 'shop_owner') {
      // Never trust a shopId from the query string for non-admins
      query.shopId = userShopId;
    } else if (role === 'admin') {
      // Admin may optionally filter by a specific shop
      if (req.query.shopId) {
        query.shopId = req.query.shopId;
      }
      // No shopId filter → admin sees all shops
    }

    const [history, total] = await Promise.all([
      ImportHistory.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-errorDetails')   // keep the list response lean
        .populate('userId', 'firstName lastName email')
        .lean(),
      ImportHistory.countDocuments(query)
    ]);

    res.json({
      success: true,
      history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─── DELIVERY EXPORT MODULE ────────────────────────────────────────────────────

// ─── EXPORT TEMPLATE MODULE ───────────────────────────────────────────────────

/**
 * GET /api/orders/export/templates
 * List all saved custom-export templates for the authenticated shop owner.
 *
 * Permissions: shop_owner only.
 * Returns templates ordered by most recently created first.
 */
router.get('/export/templates', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const templates = await ExportTemplate.find({ shopId: req.user.shopId })
      .sort({ createdAt: -1 })
      .select('-__v')
      .lean();

    res.json({ success: true, templates });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/export/templates
 * Create a new named custom-export template for the authenticated shop.
 *
 * Body: { name, columns, isDefault? }
 *
 * Validation:
 *   - name required, 1-100 chars
 *   - columns: non-empty array, valid keys, no duplicates
 *   - duplicate name within same shop → 409
 *   - if isDefault true → clears any existing default first
 */
router.post('/export/templates', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { name, columns, isDefault = false } = req.body;

    // ── name validation ───────────────────────────────────────────────────────
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or fewer' });
    }

    // ── columns validation (reuse ExportService logic) ────────────────────────
    const colError = ExportTemplate.validateColumns(columns)
      ? null
      : buildColumnError(columns);
    if (colError) return res.status(400).json({ error: colError });

    // ── duplicate name check ──────────────────────────────────────────────────
    const existing = await ExportTemplate.findOne({
      shopId: req.user.shopId,
      name:   name.trim()
    });
    if (existing) {
      return res.status(409).json({
        error: `A template named "${name.trim()}" already exists for this shop`
      });
    }

    // ── if setting as default, unset all current defaults first ──────────────
    if (isDefault) {
      await ExportTemplate.updateMany(
        { shopId: req.user.shopId, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    const template = await ExportTemplate.create({
      shopId:    req.user.shopId,
      userId:    req.user._id,
      name:      name.trim(),
      columns,
      isDefault: Boolean(isDefault)
    });

    res.status(201).json({ success: true, template });
  } catch (error) {
    // Catch MongoDB duplicate-key error as a safety net
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'A template with that name already exists for this shop'
      });
    }
    next(error);
  }
});

/**
 * PUT /api/orders/export/templates/:id
 * Update an existing template's name, columns, and/or isDefault flag.
 *
 * Permissions: shop_owner, own shop only.
 * Body: { name?, columns?, isDefault? }  — all optional, at least one required.
 */
router.put('/export/templates/:id', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const template = await ExportTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // ── shop isolation ────────────────────────────────────────────────────────
    if (String(template.shopId) !== String(req.user.shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updates = {};

    // ── name update ───────────────────────────────────────────────────────────
    if (req.body.name !== undefined) {
      const newName = String(req.body.name).trim();
      if (newName.length === 0) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
      if (newName.length > 100) {
        return res.status(400).json({ error: 'name must be 100 characters or fewer' });
      }
      // Check for duplicate name (excluding this template)
      const dupe = await ExportTemplate.findOne({
        shopId: req.user.shopId,
        name:   newName,
        _id:    { $ne: template._id }
      });
      if (dupe) {
        return res.status(409).json({
          error: `A template named "${newName}" already exists for this shop`
        });
      }
      updates.name = newName;
    }

    // ── columns update ────────────────────────────────────────────────────────
    if (req.body.columns !== undefined) {
      const colError = ExportTemplate.validateColumns(req.body.columns)
        ? null
        : buildColumnError(req.body.columns);
      if (colError) return res.status(400).json({ error: colError });
      updates.columns = req.body.columns;
    }

    // ── isDefault update ──────────────────────────────────────────────────────
    if (req.body.isDefault !== undefined) {
      const becomesDefault = Boolean(req.body.isDefault);
      if (becomesDefault) {
        await ExportTemplate.updateMany(
          { shopId: req.user.shopId, isDefault: true, _id: { $ne: template._id } },
          { $set: { isDefault: false } }
        );
      }
      updates.isDefault = becomesDefault;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updated = await ExportTemplate.findByIdAndUpdate(
      template._id,
      { $set: updates },
      { new: true, runValidators: true, select: '-__v' }
    );

    res.json({ success: true, template: updated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'A template with that name already exists for this shop'
      });
    }
    next(error);
  }
});

/**
 * DELETE /api/orders/export/templates/:id
 * Delete a template. Only the owning shop can delete it.
 */
router.delete('/export/templates/:id', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const template = await ExportTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // ── shop isolation ────────────────────────────────────────────────────────
    if (String(template.shopId) !== String(req.user.shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await ExportTemplate.findByIdAndDelete(template._id);

    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    next(error);
  }
});

// ─── Helper: build a human-readable column error message ─────────────────────

function buildColumnError(columns) {
  const { ALLOWED_COLUMN_KEYS } = ExportTemplate;
  if (!Array.isArray(columns)) return 'columns must be an array';
  if (columns.length === 0)    return 'columns must contain at least one column';
  const invalid = columns.filter(c => !ALLOWED_COLUMN_KEYS.includes(c));
  if (invalid.length > 0) {
    return `Invalid column key(s): ${invalid.join(', ')}. Allowed: ${ALLOWED_COLUMN_KEYS.join(', ')}`;
  }
  const seen = new Set();
  for (const col of columns) {
    if (seen.has(col)) return `Duplicate column key: ${col}`;
    seen.add(col);
  }
  return 'Invalid columns';
}



/**
 * POST /api/orders/export/logistics
 * Export orders in a logistics-provider-specific format.
 * Body: { provider: string, fileType: "csv"|"xlsx", orderIds?: string[] }
 *
 * Supported providers: generic, intigo, aramex, rapid_poste, yalidine, custom
 * Unsupported providers: none remaining
 */
router.post('/export/logistics', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { provider = 'generic', fileType = 'csv', orderIds } = req.body;

    const normalizedProvider = String(provider).toLowerCase().trim();
    const normalizedFileType = String(fileType).toLowerCase().trim();

    const logLogisticsExport = async () => {
      const { logActivity } = require('../services/activityLogService');

      const providerNames = {
        generic: 'Générique',
        intigo: 'Intigo',
        colissimo: 'Colissimo',
        aramex: 'Aramex',
        rapid_poste: 'Rapid Poste',
        yalidine: 'Yalidine',
        custom: 'Export personnalisé'
      };

      const providerLabel =
        providerNames[normalizedProvider] ||
        normalizedProvider;

      const selectedCount =
        Array.isArray(orderIds)
          ? orderIds.length
          : null;

      await logActivity(
        'export',
        'Export effectué',
        selectedCount !== null
          ? `${selectedCount} commande(s) exportée(s) vers ${providerLabel}`
          : `Export de commandes effectué vers ${providerLabel}`
      );
    };

    if (!['csv', 'xlsx'].includes(normalizedFileType)) {
      return res.status(400).json({ error: 'fileType must be "csv" or "xlsx"' });
    }

    // ── Generic export ──────────────────────────────────────────────────────
    if (normalizedProvider === 'generic') {
      const filters = { orderIds };
      const csv = await exportService.exportOrdersToCSV(filters, req.user);
      const filename = `generic-export.${normalizedFileType}`;

      if (normalizedFileType === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await logLogisticsExport();
        return res.send(csv);
      }
      // XLSX for generic: convert CSV to XLSX via SheetJS
      const XLSX = require('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(
        csv.split('\n').map(row =>
          row.split(',').map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"'))
        )
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Intigo export ───────────────────────────────────────────────────────
    if (normalizedProvider === 'intigo') {
      const ids = Array.isArray(orderIds) ? orderIds : [];

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportIntigoCSV(ids, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="intigo-export.csv"');
        await logLogisticsExport();
        return res.send(csv);
      }

      // xlsx
      const buf = await exportService.exportIntigoXLSX(ids, req.user);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="intigo-export.xlsx"');
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Colissimo export ─────────────────────────────────────────────────────
    if (normalizedProvider === 'colissimo') {
      const ids = Array.isArray(orderIds) ? orderIds : [];

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportColissimoCSV(ids, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="colissimo-export.csv"');
        await logLogisticsExport();
        return res.send(csv);
      }

      const buf = await exportService.exportColissimoXLSX(ids, req.user);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="colissimo-export.xlsx"'
      );
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Aramex export ────────────────────────────────────────────────────────
    if (normalizedProvider === 'aramex') {
      const ids = Array.isArray(orderIds) ? orderIds : [];

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportAramexCSV(ids, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="aramex-export.csv"');
        await logLogisticsExport();
        return res.send(csv);
      }

      // xlsx
      const buf = await exportService.exportAramexXLSX(ids, req.user);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="aramex-export.xlsx"');
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Rapid Poste export ───────────────────────────────────────────────────
    if (normalizedProvider === 'rapid_poste') {
      const ids = Array.isArray(orderIds) ? orderIds : [];

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportRapidPosteCSV(ids, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="rapid-poste-export.csv"');
        await logLogisticsExport();
        return res.send(csv);
      }

      // xlsx
      const buf = await exportService.exportRapidPosteXLSX(ids, req.user);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="rapid-poste-export.xlsx"');
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Yalidine export ──────────────────────────────────────────────────────
    if (normalizedProvider === 'yalidine') {
      const ids = Array.isArray(orderIds) ? orderIds : [];

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportYalidineCSV(ids, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="yalidine-export.csv"');
        await logLogisticsExport();
        return res.send(csv);
      }

      // xlsx
      const buf = await exportService.exportYalidineXLSX(ids, req.user);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="yalidine-export.xlsx"');
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Custom export ────────────────────────────────────────────────────────
    if (normalizedProvider === 'custom') {
      const ids     = Array.isArray(orderIds) ? orderIds : [];
      const columns = req.body.columns;

      // Validate columns array
      const validationError = exportService.constructor.validateCustomColumns(columns);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportCustomCSV(ids, req.user, columns);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="custom-export.csv"');
        await logLogisticsExport();
        return res.send(csv);
      }

      // xlsx
      const buf = await exportService.exportCustomXLSX(ids, req.user, columns);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="custom-export.xlsx"');
      await logLogisticsExport();
      return res.send(buf);
    }

    // ── Unsupported providers (future-proofing) ──────────────────────────────
    return res.status(422).json({
      error: `Provider "${provider}" is not configured yet`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/ready-to-ship
 * Get orders that are ready for shipping (confirmed, complete info, no blocks).
 * Supports pagination and filtering.
 */
router.get('/ready-to-ship', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, aiScoreMin = 0 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const aiMin = parseInt(aiScoreMin, 10) || 0;

    const query = {
      shopId: req.user.shopId,
      status: 'confirmed',
      'clientInfo.phone': { $exists: true, $ne: '' },
      'clientInfo.name': { $exists: true, $ne: '' }
    };

    // Apply AI score filter if threshold set
    if (aiMin > 0) {
      query.$or = [
        { aiScore: { $gte: aiMin } },
        { aiScore: { $exists: false } } // orders without score are included
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('orderId clientInfo items totalAmount status aiScore riskLevel region createdAt deliveryInfo')
        .lean(),
      Order.countDocuments(query)
    ]);

    res.json({
      orders,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/export-delivery
 * Export confirmed orders formatted for a specific delivery company.
 * Body: { courierName: string, orderIds?: string[] }
 * Returns a CSV file.
 */
router.post('/export-delivery', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { courierName = 'general', orderIds } = req.body;

    // Build query
    const query = {
      shopId: req.user.shopId,
      status: 'confirmed'
    };

    if (orderIds && Array.isArray(orderIds) && orderIds.length > 0) {
      query._id = { $in: orderIds };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Aucune commande prête à expédier trouvée' });
    }

    // Generate CSV based on courier format
    const csv = generateDeliveryCSV(orders, courierName);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `export-livraison-${courierName.toLowerCase()}-${dateStr}.csv`;

    const { logActivity } = require('../services/activityLogService');

    await logActivity(
      'export',
      'Export effectué',
      `${orders.length} commande(s) exportée(s) vers ${courierName}`
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM for Excel compatibility
  } catch (error) {
    next(error);
  }
});

/**
 * Generate a CSV string for delivery company exports.
 * @param {object[]} orders
 * @param {string} courierName
 * @returns {string}
 */
function generateDeliveryCSV(orders, courierName) {
  const esc = (v) => {
    const s = String(v || '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  // Courier-specific column layouts
  const courierFormats = {
    intigo: ['Référence', 'Nom Client', 'Téléphone', 'Adresse', 'Ville', 'Gouvernorat', 'Montant', 'Produit', 'Quantité'],
    aramex: ['Reference', 'Consignee Name', 'Consignee Phone', 'Consignee Address', 'City', 'Country', 'COD Amount', 'Item Description'],
    yalidine: ['Tracking', 'Nom', 'Téléphone', 'Adresse', 'Wilaya', 'Commune', 'Montant', 'Produit'],
    rapid_poste: ['N° Commande', 'Destinataire', 'Téléphone', 'Adresse Livraison', 'Code Postal', 'Gouvernorat', 'Montant COD'],
    general: ['N° Commande', 'Nom Client', 'Téléphone', 'Adresse', 'Ville', 'Région', 'Montant Total', 'Produits', 'Statut']
  };

  const format = courierName.toLowerCase().replace(/\s+/g, '_');
  const headers = courierFormats[format] || courierFormats.general;

  const rows = orders.map(order => {
    const name = order.clientInfo?.name || '';
    const phone = order.clientInfo?.phone || '';
    const address = order.clientInfo?.address;
    const street = address?.street || '';
    const city = address?.city || '';
    const region = address?.state || order.region || '';
    const zipCode = address?.zipCode || '';
    const amount = order.totalAmount || 0;
    const items = (order.items || []).map(i => `${i.name} x${i.quantity}`).join(' | ');

    switch (format) {
      case 'intigo':
        return [order.orderId, name, phone, street, city, region, amount, items, (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0)];
      case 'aramex':
        return [order.orderId, name, phone, `${street} ${city}`.trim(), city, 'TN', amount, items];
      case 'yalidine':
        return [order.orderId, name, phone, street, region, city, amount, items];
      case 'rapid_poste':
        return [order.orderId, name, phone, street, zipCode, region, amount];
      default:
        return [order.orderId, name, phone, street, city, region, amount, items, order.status];
    }
  });

  return [
    headers.map(esc).join(','),
    ...rows.map(row => row.map(esc).join(','))
  ].join('\n');
}

module.exports = router;
