const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  externalId: {
    type: String // Only required for auto-synced products
  },
  name: {
    type: String,
    required: true
  },
  productLink: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    min: 0,
    default: 0
  },
  deliveryFee: {
    type: Number,
    min: 0,
    default: 0
  },
  sku: String,
  description: {
    type: String,
    default: ''
  },

  // Instructions du propriétaire de la boutique destinées
  // à l'opérateur pendant l'appel.
  sellerNotes: {
    type: String,
    default: ''
  },

  imageUrl: {
    type: String,
    default: ''
  },
  imageUploadedAt: {
    type: Date
  },
  category: String,
  inStock: {
    type: Boolean,
    default: true
  },
  syncMethod: {
    type: String,
    enum: ['manual', 'auto_sync'],
    default: 'manual'
  },
  lastSyncAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

productSchema.index({ shopId: 1, externalId: 1 });
productSchema.index({ syncMethod: 1 });
productSchema.index({ shopId: 1, sku: 1 });

module.exports = mongoose.model('Product', productSchema);