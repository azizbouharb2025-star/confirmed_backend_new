const mongoose = require('mongoose');

/**
 * ImportHistory Model
 * Tracks all bulk import operations performed by shop owners.
 * Used for the import history dashboard feature.
 *
 * Fields:
 *  shopId        — shop that owns the imported orders
 *  userId        — user who triggered the confirmed import
 *  fileName      — original uploaded filename
 *  fileType      — 'xlsx' or 'csv'
 *  fileSize      — size of the uploaded file in bytes (when available)
 *  totalDetected — total rows/orders detected in the file
 *  totalImported — orders successfully inserted into the database
 *  totalRejected — rows rejected due to validation errors or save failures
 *  totalDuplicates — rows detected as duplicates (and ignored, depending on policy)
 *  errorsDetected  — number of rows with hard validation errors
 *  status        — completed: all importable rows saved
 *                  partial:   some rows saved, some failed at the DB insert step
 *                  failed:    no rows were imported at all
 *  errorDetails  — structured per-row error summary (never the full file content)
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
  fileSize: {
    type: Number,       // bytes
    default: null
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
    // completed : every importable row was saved
    // partial   : some rows saved, some failed at DB insert
    // failed    : zero rows were imported
    // pending / processing kept for forward-compat with async queues
    enum: ['pending', 'processing', 'completed', 'partial', 'failed'],
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

// Primary lookup: shop history list (most common query)
importHistorySchema.index({ shopId: 1, createdAt: -1 });

// Secondary: per-user history (admin or personal audit views)
importHistorySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ImportHistory', importHistorySchema);
