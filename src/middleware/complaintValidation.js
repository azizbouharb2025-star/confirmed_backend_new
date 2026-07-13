const Joi = require('joi');

const COMPLAINT_CATEGORIES = [
  'damaged_product',
  'wrong_item',
  'missing_item',
  'quality_issue',
  'delivery_problem',
  'other'
];

const COMPLAINT_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'closed',
  'escalated'
];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_TOTAL_MEDIA_SIZE = 50 * 1024 * 1024; // 50MB in bytes

const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const dataToValidate = source === 'query' ? req.query : req.body;
    const { error, value } = schema.validate(dataToValidate, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: error.details.map(detail => detail.message)
      });
    }
    if (source === 'query') {
      req.query = value;
    } else {
      req.body = value;
    }
    next();
  };
};

const mediaAttachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  type: Joi.string().valid('image', 'video').required(),
  mimeType: Joi.string().valid(...ALLOWED_MEDIA_TYPES).required(),
  size: Joi.number().positive().required()
});

const complaintSchemas = {
  // Schema for submitting a new complaint
  submitComplaint: Joi.object({
    token: Joi.string().required(),
    category: Joi.string().valid(...COMPLAINT_CATEGORIES).required()
      .messages({
        'any.only': 'Invalid category. Must be one of: ' + COMPLAINT_CATEGORIES.join(', ')
      }),
    description: Joi.string().min(10).required()
      .messages({
        'string.min': 'Description must be at least 10 characters long'
      }),
    mediaAttachments: Joi.array().items(mediaAttachmentSchema).default([])
      .custom((value, helpers) => {
        const totalSize = value.reduce((sum, attachment) => sum + attachment.size, 0);
        if (totalSize > MAX_TOTAL_MEDIA_SIZE) {
          return helpers.error('custom.maxSize');
        }
        return value;
      })
      .messages({
        'custom.maxSize': 'Total media attachments size must not exceed 50MB'
      })
  }),

  // Schema for updating complaint status
  updateStatus: Joi.object({
    status: Joi.string().valid(...COMPLAINT_STATUSES).required()
      .messages({
        'any.only': 'Invalid status. Must be one of: ' + COMPLAINT_STATUSES.join(', ')
      }),
    note: Joi.string().allow('').optional()
  }),

  // Schema for adding a resolution note
  addNote: Joi.object({
    note: Joi.string().min(1).required()
      .messages({
        'string.empty': 'Note cannot be empty',
        'string.min': 'Note cannot be empty'
      })
  }),

  // Schema for filtering complaints list
  filterComplaints: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid(...COMPLAINT_STATUSES).optional(),
    category: Joi.string().valid(...COMPLAINT_CATEGORIES).optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    productId: Joi.string().optional(),
    region: Joi.string().optional(),
    search: Joi.string().optional(),
    shopId: Joi.string().optional() // For admin filtering
  }),

  // Schema for bulk support card generation
  bulkSupportCards: Joi.object({
    orderIds: Joi.array().items(Joi.string()).min(1).required()
      .messages({
        'array.min': 'At least one order ID is required'
      })
  }),

  // Schema for analytics filters
  analyticsFilter: Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    shopId: Joi.string().optional() // For admin filtering
  })
};

module.exports = {
  validate,
  complaintSchemas,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_MEDIA_TYPES,
  MAX_TOTAL_MEDIA_SIZE
};
