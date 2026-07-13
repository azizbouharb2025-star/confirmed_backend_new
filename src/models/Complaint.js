const mongoose = require('mongoose');

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

const complaintSchema = new mongoose.Schema({
  referenceNumber: {
    type: String,
    required: true,
    unique: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  supportCardTokenId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportCardToken'
  },
  customerInfo: {
    name: {
      type: String,
      required: true
    },
    phone: {
      type: String
    },
    email: {
      type: String
    }
  },
  category: {
    type: String,
    enum: COMPLAINT_CATEGORIES,
    required: true
  },
  description: {
    type: String,
    required: true,
    minlength: 10
  },
  mediaAttachments: [{
    url: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['image', 'video'],
      required: true
    },
    mimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'],
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  aiTags: [{
    tag: {
      type: String,
      required: true
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      required: true
    }
  }],
  aiPrimaryCategory: {
    type: String
  },
  requiresManualReview: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: COMPLAINT_STATUSES,
    default: 'open'
  },
  resolutionHistory: [{
    status: {
      type: String,
      enum: COMPLAINT_STATUSES
    },
    note: {
      type: String
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  resolvedAt: {
    type: Date
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  region: {
    type: String
  },
  productIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }]
}, {
  timestamps: true
});

// Indexes
complaintSchema.index({ referenceNumber: 1 }, { unique: true });
complaintSchema.index({ shopId: 1, status: 1 });
complaintSchema.index({ shopId: 1, category: 1 });
complaintSchema.index({ shopId: 1, createdAt: -1 });
complaintSchema.index({ orderId: 1 });

// Export constants for use in validation
module.exports = mongoose.model('Complaint', complaintSchema);
module.exports.COMPLAINT_CATEGORIES = COMPLAINT_CATEGORIES;
module.exports.COMPLAINT_STATUSES = COMPLAINT_STATUSES;
