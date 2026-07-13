const mongoose = require('mongoose');

const missionSchema = new mongoose.Schema({
  operatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  target: {
    type: Number,
    required: true
  },
  current: {
    type: Number,
    default: 0
  },
  reward: {
    type: Number,
    required: true
  },
  rewardType: {
    type: String,
    enum: ['cash', 'points', 'badge'],
    default: 'cash'
  },
  type: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'expired', 'claimed'],
    default: 'active'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

missionSchema.index({ operatorId: 1, status: 1 });
missionSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('Mission', missionSchema);
