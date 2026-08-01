const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const Order = require('../models/Order');
const ImportHistory = require('../models/ImportHistory');
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
  orderId: Joi.string().required(),
  clientInfo: Joi.object({
    name: Joi.string().required(),
    phone: Joi.string().required(),
    email: Joi.string().email(),
    address: Joi.object({
      street: Joi.string(),
      city: Joi.string(),
      state: Joi.string(),
      zipCode: Joi.string(),
      country: Joi.string()
    })
  }).required(),
  items: Joi.array().items(Joi.object({
    name: Joi.string(),
    quantity: Joi.number(),
    price: Joi.number(),
    sku: Joi.string()
  })),
  totalAmount: Joi.number().required(),
  deliveryInfo: Joi.object({
    estimatedDate: Joi.date(),
    trackingNumber: Joi.string(),
    carrier: Joi.string()
  })
});

const bulkStatusSchema = Joi.object({
  orderIds: Joi.array().items(Joi.string()).min(1).required(),
  status: Joi.string().valid('pending', 'confirmed', 'called', 'delivered', 'cancelled').required()
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

    const order = await orderService.createOrder({
      ...req.body,
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
    const { limit = 10 } = req.query;
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    
    const query = shopId ? { shopId } : {};
    
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('orderId clientInfo.name totalAmount status createdAt items')
      .lean();
    
    res.json(orders.map(order => ({
      id: order._id,
      orderId: order.orderId,
      customerName: order.clientInfo?.name || 'Unknown',
      amount: order.totalAmount,
      status: order.status,
      createdAt: order.createdAt,
      itemCount: order.items?.length || 0
    })));
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
    
    const validStatuses = ['pending', 'confirmed', 'called', 'delivered', 'cancelled'];
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

/**
 * POST /api/orders/export/logistics
 * Export orders in a logistics-provider-specific format.
 * Body: { provider: string, fileType: "csv"|"xlsx", orderIds?: string[] }
 *
 * Supported providers: generic, intigo
 * Unsupported providers: aramex, rapid_poste, custom → 422 "not configured yet"
 */
router.post('/export/logistics', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { provider = 'generic', fileType = 'csv', orderIds } = req.body;

    const normalizedProvider = String(provider).toLowerCase().trim();
    const normalizedFileType = String(fileType).toLowerCase().trim();

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
      return res.send(buf);
    }

    // ── Intigo export ───────────────────────────────────────────────────────
    if (normalizedProvider === 'intigo') {
      const ids = Array.isArray(orderIds) ? orderIds : [];

      if (normalizedFileType === 'csv') {
        const csv = await exportService.exportIntigoCSV(ids, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="intigo-export.csv"');
        return res.send(csv);
      }

      // xlsx
      const buf = await exportService.exportIntigoXLSX(ids, req.user);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="intigo-export.xlsx"');
      return res.send(buf);
    }

    // ── Unsupported providers ───────────────────────────────────────────────
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
