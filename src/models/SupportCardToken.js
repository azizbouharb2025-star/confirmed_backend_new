const mongoose = require('mongoose');

const supportCardTokenSchema = new mongoose.Schema({
  token: {
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
  expiresAt: {
    type: Date,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  },
  usedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
supportCardTokenSchema.index({ token: 1 }, { unique: true });
supportCardTokenSchema.index({ orderId: 1, shopId: 1 });
supportCardTokenSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('SupportCardToken', supportCardTokenSchema);
