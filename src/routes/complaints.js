const express = require('express');
const multer = require('multer');
const path = require('path');
const { auth } = require('../middleware/auth');
const { tierMeetsMinimum, getUserTier } = require('../middleware/tierCheck');
const { validate, complaintSchemas, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } = require('../middleware/complaintValidation');
const supportCardService = require('../services/supportCardService');
const complaintService = require('../services/complaintService');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/complaints');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG images and MP4, MOV videos are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max per file
    files: 5 // Max 5 files
  }
});

/**
 * Middleware to check if user has Pro+ tier access
 * **Validates: Requirements 3.1, 4.1**
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
          message: 'Complaint management requires Pro tier or higher'
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
 * Middleware to check if user has Business+ tier access
 * **Validates: Requirements 6.3**
 */
const requireBusinessTier = async (req, res, next) => {
  try {
    const tier = await getUserTier(req.user);
    if (!tierMeetsMinimum(tier, 'business')) {
      return res.status(403).json({
        error: 'Feature not available',
        code: 'TIER_RESTRICTION',
        details: {
          currentTier: tier,
          requiredTier: 'business',
          message: 'Complaint analytics requires Business tier or higher'
        }
      });
    }
    req.userTier = tier;
    next();
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

/**
 * GET /api/complaints/validate-token/:token
 * Validate token and return order context for complaint form
 * **Validates: Requirements 2.1**
 * 
 * @param {string} token - Support card token
 * @returns {Object} Order context if token is valid
 */
router.get('/validate-token/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await supportCardService.validateToken(token);

    if (!result.valid) {
      const statusCode = result.code === 'TOKEN_EXPIRED' ? 410 : 400;
      return res.status(statusCode).json({
        error: result.error,
        code: result.code
      });
    }

    res.json({
      success: true,
      data: {
        order: result.order,
        shopId: result.shopId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/complaints/form/:token
 * Validate token and return order context for complaint form (alias)
 * **Validates: Requirements 2.1**
 * 
 * @param {string} token - Support card token
 * @returns {Object} Order context if token is valid
 */
router.get('/form/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await supportCardService.validateToken(token);

    if (!result.valid) {
      const statusCode = result.code === 'TOKEN_EXPIRED' ? 410 : 400;
      return res.status(statusCode).json({
        error: result.error,
        code: result.code
      });
    }

    res.json({
      success: true,
      data: {
        order: result.order,
        shopId: result.shopId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/complaints
 * Submit a new complaint
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
 * 
 * @body {string} token - Support card token
 * @body {string} category - Complaint category
 * @body {string} description - Complaint description (min 10 chars)
 * @body {Array} mediaAttachments - Optional media attachments (files)
 * @returns {Object} Created complaint with reference number
 */
const submitComplaintHandler = async (req, res, next) => {
  try {
    const { token, category, description } = req.body;

    // Build media attachments from uploaded files
    const mediaAttachments = [];
    if (req.files && req.files.length > 0) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      for (const file of req.files) {
        mediaAttachments.push({
          url: `${baseUrl}/uploads/complaints/${file.filename}`,
          type: file.mimetype.startsWith('image/') ? 'image' : 'video',
          mimeType: file.mimetype,
          size: file.size
        });
      }
    }

    // Also support mediaAttachments passed as JSON string in form data or as array from JSON
    if (req.body.mediaAttachments) {
      if (typeof req.body.mediaAttachments === 'string') {
        try {
          const parsed = JSON.parse(req.body.mediaAttachments);
          if (Array.isArray(parsed)) {
            mediaAttachments.push(...parsed);
          }
        } catch (e) {
          // Ignore parse errors
        }
      } else if (Array.isArray(req.body.mediaAttachments)) {
        mediaAttachments.push(...req.body.mediaAttachments);
      }
    }

    const complaint = await complaintService.createComplaint(
      { category, description, mediaAttachments },
      token
    );

    res.status(201).json({
      success: true,
      data: {
        referenceNumber: complaint.referenceNumber,
        complaintId: complaint._id,
        status: complaint.status,
        createdAt: complaint.createdAt
      }
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
};

// Middleware to handle both JSON and FormData
const handleMultipart = upload.array('media', 5);

const multipartMiddleware = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  
  // If it's JSON, skip multer (express.json() already parsed it)
  if (contentType.includes('application/json')) {
    return next();
  }
  
  // Handle multipart/form-data
  handleMultipart(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: err.message,
        code: 'FILE_UPLOAD_ERROR'
      });
    } else if (err) {
      return res.status(400).json({
        error: err.message,
        code: 'FILE_UPLOAD_ERROR'
      });
    }
    next();
  });
};

// Validation middleware that works after multer parses the form
const validateComplaintBody = (req, res, next) => {
  const { token, category, description } = req.body;
  const errors = [];

  if (!token) errors.push('token is required');
  if (!category) errors.push('category is required');
  if (!description) errors.push('description is required');
  else if (description.length < 10) errors.push('description must be at least 10 characters');

  const validCategories = ['damaged_product', 'wrong_item', 'missing_item', 'quality_issue', 'delivery_problem', 'other'];
  if (category && !validCategories.includes(category)) {
    errors.push(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'VALIDATION_ERROR',
      details: errors
    });
  }
  next();
};

router.post('/', multipartMiddleware, validateComplaintBody, submitComplaintHandler);
router.post('/submit', multipartMiddleware, validateComplaintBody, submitComplaintHandler);


// ============================================
// AUTHENTICATED ROUTES (Pro+ tier required)
// ============================================

/**
 * GET /api/complaints
 * List complaints with pagination, filtering, and search
 * **Validates: Requirements 3.1, 3.2, 3.3, 7.3**
 * 
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Items per page (default: 20, max: 100)
 * @query {string} status - Filter by status
 * @query {string} category - Filter by category
 * @query {string} startDate - Filter by date range start
 * @query {string} endDate - Filter by date range end
 * @query {string} productId - Filter by product ID
 * @query {string} region - Filter by region
 * @query {string} search - Search across referenceNumber, customerInfo.name, description
 * @query {string} shopId - Filter by shop ID (admin only)
 * @returns {Object} Paginated complaints list
 */
router.get(
  '/',
  auth,
  requireProTier,
  validate(complaintSchemas.filterComplaints, 'query'),
  async (req, res, next) => {
    try {
      const result = await complaintService.findComplaints(req.query, req.user);
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/complaints/summary
 * Get dashboard summary with counts grouped by status and category
 * **Validates: Requirements 3.5**
 * 
 * @returns {Object} Summary with byStatus and byCategory counts
 */
router.get('/summary', auth, requireProTier, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;

    if (!shopId) {
      return res.status(400).json({
        error: 'Shop ID not found for user',
        code: 'SHOP_NOT_FOUND'
      });
    }

    const summary = await complaintService.getDashboardSummary(shopId);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/complaints/analytics
 * Get complaint analytics (Business+ tier)
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 7.1, 7.2**
 * 
 * @query {string} startDate - Filter by date range start
 * @query {string} endDate - Filter by date range end
 * @query {string} shopId - Filter by shop ID (admin only)
 * @returns {Object} Analytics with aggregations by product, region, category
 */
router.get(
  '/analytics',
  auth,
  requireBusinessTier,
  validate(complaintSchemas.analyticsFilter, 'query'),
  async (req, res, next) => {
    try {
      const analytics = await complaintService.getAnalytics(req.query, req.user);

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/complaints/export
 * Export complaints to CSV
 * **Validates: Requirements 9.1, 9.2, 9.3**
 * 
 * @query {string} status - Filter by status
 * @query {string} category - Filter by category
 * @query {string} startDate - Filter by date range start
 * @query {string} endDate - Filter by date range end
 * @returns {string} CSV file download
 */
router.get(
  '/export',
  auth,
  requireProTier,
  validate(complaintSchemas.filterComplaints, 'query'),
  async (req, res, next) => {
    try {
      const csv = await complaintService.exportToCSV(req.query, req.user);

      // Set appropriate headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="complaints-export.csv"');

      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/complaints/:id
 * Get complaint details
 * **Validates: Requirements 3.4**
 * 
 * @param {string} id - Complaint ID (MongoDB _id)
 * @returns {Object} Complete complaint with order context, media attachments, resolution history
 */
router.get('/:id', auth, requireProTier, async (req, res, next) => {
  try {
    const complaint = await complaintService.findComplaintById(req.params.id, req.user);

    res.json({
      success: true,
      data: complaint
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
 * PATCH /api/complaints/:id/status
 * Update complaint status
 * **Validates: Requirements 4.1, 4.3, 4.4**
 * 
 * @param {string} id - Complaint ID (MongoDB _id)
 * @body {string} status - New status
 * @body {string} note - Optional note for the status change
 * @returns {Object} Updated complaint
 */
router.patch(
  '/:id/status',
  auth,
  requireProTier,
  validate(complaintSchemas.updateStatus),
  async (req, res, next) => {
    try {
      const { status, note } = req.body;

      const complaint = await complaintService.updateStatus(
        req.params.id,
        status,
        note,
        req.user
      );

      res.json({
        success: true,
        data: complaint
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
  }
);

/**
 * POST /api/complaints/:id/notes
 * Add resolution note to complaint
 * **Validates: Requirements 4.2**
 * 
 * @param {string} id - Complaint ID (MongoDB _id)
 * @body {string} note - Note content
 * @returns {Object} Updated complaint
 */
router.post(
  '/:id/notes',
  auth,
  requireProTier,
  validate(complaintSchemas.addNote),
  async (req, res, next) => {
    try {
      const { note } = req.body;

      const complaint = await complaintService.addResolutionNote(
        req.params.id,
        note,
        req.user
      );

      res.json({
        success: true,
        data: complaint
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
  }
);

module.exports = router;
