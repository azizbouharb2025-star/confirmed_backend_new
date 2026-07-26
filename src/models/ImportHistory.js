const mongoose = require('mongoose');

/**
 * ImportHistory Model
 * Tracks all bulk import operations performed by shop owners.
 * Used for the import history dashboard feature.
 */
const importHistorySchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    enum: ['xlsx', 'csv'],
    required: true
  },
  totalDetected: {
    type: Number,
    default: 0
  },
  totalImported: {
    type: Number,
    default: 0
  },
  totalRejected: {
    type: Number,
    default: 0
  },
  totalDuplicates: {
    type: Number,
    default: 0
  },
  errorsDetected: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'completed'
  },
  errorDetails: [{
    row: Number,
    field: String,
    message: String
  }]
}, {
  timestamps: true
});

importHistorySchema.index({ shopId: 1, createdAt: -1 });

module.exports = mongoose.model('ImportHistory', importHistorySchema);
