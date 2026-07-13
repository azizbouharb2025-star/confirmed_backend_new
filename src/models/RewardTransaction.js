const mongoose = require('mongoose');

const rewardTransactionSchema = new mongoose.Schema({
  operatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  missionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Mission'
  },
  date: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

rewardTransactionSchema.index({ operatorId: 1, date: -1 });

module.exports = mongoose.model('RewardTransaction', rewardTransactionSchema);
