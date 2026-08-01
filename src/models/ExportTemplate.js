const mongoose = require('mongoose');
const { ExportService } = require('../services/exportService');

/**
 * ExportTemplate Model
 *
 * Stores named custom-export column selections for a shop.
 * Allows shop owners to save, reuse, and manage export presets.
 *
 * Fields:
 *   shopId    — owning shop (required, never from request body)
 *   userId    — user who created the template
 *   name      — human-readable label, unique within the same shop
 *   columns   — ordered array of custom-column keys (validated against allowed list)
 *   isDefault — whether this is the shop's default custom template
 */

// ─── Column validation ────────────────────────────────────────────────────────

const ALLOWED_COLUMN_KEYS = Object.keys(ExportService.CUSTOM_COLUMN_LABELS);

function validateColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return false;
  const seen = new Set();
  for (const col of columns) {
    if (!ALLOWED_COLUMN_KEYS.includes(col)) return false;
    if (seen.has(col)) return false;
    seen.add(col);
  }
  return true;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const exportTemplateSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100
    },
    columns: {
      type: [String],
      required: true,
      validate: {
        validator: validateColumns,
        message: `columns must be a non-empty array of unique keys from: ${ALLOWED_COLUMN_KEYS.join(', ')}`
      }
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Primary list query: shop's templates ordered by creation date
exportTemplateSchema.index({ shopId: 1, createdAt: -1 });

// Unique template name within a shop — enforced at DB level
exportTemplateSchema.index({ shopId: 1, name: 1 }, { unique: true });

// Quick lookup for "which template is the default"
exportTemplateSchema.index({ shopId: 1, isDefault: 1 });

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = mongoose.model('ExportTemplate', exportTemplateSchema);
module.exports.ALLOWED_COLUMN_KEYS = ALLOWED_COLUMN_KEYS;
module.exports.validateColumns     = validateColumns;
