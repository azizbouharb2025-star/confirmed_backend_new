const mongoose = require('mongoose');

const shopWalletSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true,
    unique: true,
    index: true
  },

  availableBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  pendingBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  currency: {
    type: String,
    enum: ['TND'],
    default: 'TND'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ShopWallet', shopWalletSchema);
