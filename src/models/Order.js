const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true
  },
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  clientInfo: {
    name: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    },
    email: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    }
  },
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    name: String,
    quantity: Number,
    price: Number,
    sku: String,
    url: String
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_progress', 'confirmed', 'rejected', 'cancelled', 'shipped', 'delivered', 'failed_delivery'],
    default: 'pending'
  },
  deliveryInfo: {
    estimatedDate: Date,
    trackingNumber: String,
    carrier: String
  },
  assignedOperatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  callHistory: [{
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    callType: {
      type: String,
      enum: ['human', 'ai']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    duration: Number,
    result: {
      type: String,
      enum: ['confirmed', 'rejected', 'no_answer', 'busy']
    },
    notes: String
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },

  // Pro tier fields
  aiRiskScore: {
    type: Number,
    min: 0,
    max: 100
  },
  aiScore: {
    type: Number,
    min: 0,
    max: 100,
    description: "AI confidence score for order validity (0-100%)"
  },
  riskLevel: {
    type: String,
    enum: ['high', 'medium', 'low'],
    description: "Risk level based on AI score"
  },
  deliverySuccessProbability: {
    type: Number,
    min: 0,
    max: 100,
    description: "Probability of successful delivery"
  },
  operatorFeedback: {
    confidence: {
      type: String,
      enum: ['strong', 'doubtful', 'neutral']
    },
    notes: String,
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Business tier fields
  courierAssignment: {
    courierId: String,
    courierName: String,
    assignedAt: Date
  },
  courier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Courier',
    description: "Assigned courier/delivery company"
  },
  region: {
    type: String,
    description: "Delivery region"
  },
  complaintFlags: [{
    type: String
  }],
  hasComplaint: {
    type: Boolean,
    default: false,
    description: "Flag indicating if order has associated complaints"
  },
  cancellationReason: {
    type: String,
    enum: [
      'customer_refused',
      'price_too_high',
      'quality_doubts',
      'duplicate_order',
      'fake_number',
      'not_available',
      'courier_failed',
      'customer_rejected_at_door'
    ],
    description: "Reason for order cancellation"
  },
  cancellationReasonDetails: {
    type: String,
    description: "Additional details about cancellation"
  },
  cancelledBy: {
    type: String,
    enum: ['customer', 'operator', 'system', 'courier'],
    description: "Who cancelled the order"
  },
  deliveryAttempts: [{
    attemptNumber: Number,
    attemptDate: Date,
    status: {
      type: String,
      enum: ['failed', 'customer_not_home', 'refused', 'successful']
    },
    notes: String
  }],

  // Enterprise tier fields
  isRepeatBuyer: {
    type: Boolean,
    default: false
  },
  customerLifetimeValue: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

orderSchema.index({ shopId: 1, status: 1 });
orderSchema.index({ assignedOperatorId: 1 });
orderSchema.index({ orderId: 1, shopId: 1 }, { unique: true });

// Indexes for tier-specific filterable fields
orderSchema.index({ aiRiskScore: 1 });
orderSchema.index({ aiScore: 1 });
orderSchema.index({ riskLevel: 1 });
orderSchema.index({ courier: 1 });
orderSchema.index({ region: 1 });
orderSchema.index({ hasComplaint: 1 });
orderSchema.index({ 'courierAssignment.courierName': 1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);