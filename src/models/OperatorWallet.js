const mongoose = require('mongoose');

const operatorWalletSchema = new mongoose.Schema({
  operatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    default: 0
  },
  pendingRewards: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

operatorWalletSchema.index({ operatorId: 1 });

module.exports = mongoose.model('OperatorWallet', operatorWalletSchema);
