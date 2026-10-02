const mongoose = require('mongoose');

const shopWalletTransactionSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true,
    index: true
  },

  walletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShopWallet',
    required: true,
    index: true
  },

  type: {
    type: String,
    enum: ['credit', 'debit', 'adjustment', 'refund'],
    required: true
  },

  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'completed'
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  currency: {
    type: String,
    enum: ['TND'],
    default: 'TND'
  },

  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },

  reference: {
    type: String,
    trim: true,
    maxlength: 120,
    default: null
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

shopWalletTransactionSchema.index({ shopId: 1, createdAt: -1 });
shopWalletTransactionSchema.index({ walletId: 1, createdAt: -1 });

module.exports = mongoose.model(
  'ShopWalletTransaction',
  shopWalletTransactionSchema
);
