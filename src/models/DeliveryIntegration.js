const mongoose = require('mongoose');

const deliveryIntegrationSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  platform: {
    type: String,
    enum: ['aramex', 'dhl', 'fedex', 'local_courier', 'custom'],
    required: true
  },
  credentials: {
    apiKey: String,
    apiSecret: String,
    username: String,
    password: String,
    accountNumber: String,
    baseUrl: String
  },
  settings: {
    autoCreateShipment: {
      type: Boolean,
      default: false
    },
    trackingEnabled: {
      type: Boolean,
      default: true
    },
    webhookUrl: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

deliveryIntegrationSchema.index({ shopId: 1, platform: 1 }, { unique: true });

module.exports = mongoose.model('DeliveryIntegration', deliveryIntegrationSchema);