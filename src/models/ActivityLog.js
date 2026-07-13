const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['user', 'order', 'system', 'payment'],
    required: true
  },
  action: {
    type: String,
    required: true
  },
  detail: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

activityLogSchema.index({ timestamp: -1 });
activityLogSchema.index({ type: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
