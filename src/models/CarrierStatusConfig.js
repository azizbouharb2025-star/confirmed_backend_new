const mongoose = require('mongoose');


// ==========================================================
// INTIGO MAPPING
// ==========================================================

const intigoMappingSchema = new mongoose.Schema(
  {
    /*
     * Exact code:
     *   5000
     *
     * Range:
     *   1000 -> 1008
     */
    matchType: {
      type: String,
      enum: [
        'exact',
        'range'
      ],
      required: true
    },

    code: {
      type: Number
    },

    rangeStart: {
      type: Number
    },

    rangeEnd: {
      type: Number
    },

    label: {
      type: String,
      trim: true,
      default: ''
    },

    /*
     * null means:
     * keep the provider status/history,
     * but do not change Order.status.
     */
    mappedOrderStatus: {
      type: String,
      enum: [
        null,
        'shipped',
        'at_depot',
        'out_for_delivery',
        'delivered',
        'returned',
        'cancelled'
      ],
      default: null
    },

    enabled: {
      type: Boolean,
      default: true
    },

    order: {
      type: Number,
      default: 0
    }
  },
  {
    _id: true
  }
);


// ==========================================================
// COLISSIMO MAPPING
// ==========================================================

const colissimoMappingSchema = new mongoose.Schema(
  {
    /*
     * Original Colissimo value.
     * Example:
     *   "Au depot"
     *   "En cours"
     *   "Livre"
     */
    providerStatus: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      trim: true,
      default: ''
    },

    /*
     * null means:
     * keep the provider status/history,
     * but do not change Order.status.
     */
    mappedOrderStatus: {
      type: String,
      enum: [
        null,
        'shipped',
        'at_depot',
        'out_for_delivery',
        'delivered',
        'returned',
        'cancelled'
      ],
      default: null
    },

    enabled: {
      type: Boolean,
      default: true
    },

    order: {
      type: Number,
      default: 0
    }
  },
  {
    _id: true
  }
);


// ==========================================================
// MAIN GLOBAL CONFIGURATION
// ==========================================================

const carrierStatusConfigSchema =
  new mongoose.Schema(
    {
      version: {
        type: Number,
        required: true,
        min: 1,
        unique: true
      },

      status: {
        type: String,
        enum: [
          'draft',
          'active',
          'archived'
        ],
        required: true,
        default: 'draft'
      },

      mappings: {
        intigo: {
          type: [intigoMappingSchema],
          default: []
        },

        colissimo: {
          type: [colissimoMappingSchema],
          default: []
        }
      },

      notes: {
        type: String,
        trim: true,
        default: ''
      },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },

      activatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },

      activatedAt: {
        type: Date,
        default: null
      },

      clonedFromVersion: {
        type: Number,
        default: null
      }
    },
    {
      timestamps: true
    }
  );


// ==========================================================
// INDEXES
// ==========================================================

carrierStatusConfigSchema.index(
  {
    status: 1
  },
  {
    unique: true,
    partialFilterExpression: {
      status: 'active'
    },
    name: 'one_active_carrier_status_config'
  }
);

carrierStatusConfigSchema.index({
  createdAt: -1
});


// ==========================================================
// EXPORT
// ==========================================================

module.exports = mongoose.model(
  'CarrierStatusConfig',
  carrierStatusConfigSchema
);
