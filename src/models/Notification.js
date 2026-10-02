const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true,
    index: true
  },

  type: {
    type: String,
    enum: [
      'order_new',
      'order_status',
      'order_deleted',
      'integration',
      'system'
    ],
    required: true
  },

  title: {
    type: String,
    required: true,
    trim: true
  },

  message: {
    type: String,
    required: true,
    trim: true
  },

  orderId: {
    type: String,
    default: null
  },

  orderStatus: {
    type: String,
    default: null
  },

  fingerprint: {
    type: String,
    required: true
  },

  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

notificationSchema.index(
  { shopId: 1, fingerprint: 1 },
  { unique: true }
);

notificationSchema.index({
  shopId: 1,
  createdAt: -1
});

module.exports = mongoose.model(
  'Notification',
  notificationSchema
);
