const mongoose = require('mongoose');

const impactField = {
  type: Number,
  required: true
};

// ==========================================================
// GENERIC RANGE RULE
// ==========================================================

const rangeRuleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    enabled: {
      type: Boolean,
      default: true
    },

    min: {
      type: Number,
      default: null
    },

    max: {
      type: Number,
      default: null
    },

    includeMin: {
      type: Boolean,
      default: true
    },

    includeMax: {
      type: Boolean,
      default: true
    },

    impact: impactField,

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
// ADDRESS
// ==========================================================

const addressElementSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true
    },

    impact: impactField,

    /*
     * Used when address mode is "exclusive".
     * Lowest number = highest priority.
     */
    priority: {
      type: Number,
      default: 100
    }
  },
  {
    _id: false
  }
);

const addressLevelSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ['complete', 'partial', 'missing']
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    enabled: {
      type: Boolean,
      default: true
    },

    impact: impactField,

    /*
     * Used when address mode is "exclusive".
     * Lowest number = highest priority.
     */
    priority: {
      type: Number,
      default: 100
    }
  },
  {
    _id: true
  }
);

// ==========================================================
// GEOGRAPHIC ZONE
// ==========================================================

const geographicRuleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    locationType: {
      type: String,
      required: true,
      enum: [
        'governorate',
        'delegation',
        'city',
        'postal_code'
      ]
    },

    locationValue: {
      type: String,
      required: true,
      trim: true
    },

    enabled: {
      type: Boolean,
      default: true
    },

    impact: impactField,

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
// ORDER TIME
// Stored as minutes since midnight.
// Example: 22:30 => 1350
// ==========================================================

const timeRuleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    enabled: {
      type: Boolean,
      default: true
    },

    startMinute: {
      type: Number,
      required: true,
      min: 0,
      max: 1439
    },

    endMinute: {
      type: Number,
      required: true,
      min: 0,
      max: 1440
    },

    impact: impactField,

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
// OPERATOR FEEDBACK
// ==========================================================

const feedbackCategorySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    active: {
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

const feedbackAnswerSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    impact: impactField,

    active: {
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

const feedbackQuestionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    categoryKey: {
      type: String,
      trim: true,
      default: 'general'
    },

    title: {
      type: String,
      required: true,
      trim: true
    },

    prompt: {
      type: String,
      required: true,
      trim: true
    },

    type: {
      type: String,
      required: true,
      enum: ['single_choice', 'multiple_choice']
    },

    active: {
      type: Boolean,
      default: true
    },

    required: {
      type: Boolean,
      default: false
    },

    maxSelections: {
      type: Number,
      default: null,
      min: 1
    },

    order: {
      type: Number,
      default: 0
    },

    answers: {
      type: [feedbackAnswerSchema],
      default: []
    }
  },
  {
    _id: true
  }
);

// ==========================================================
// MAIN CONFIGURATION
// ==========================================================

const aiScoringConfigSchema = new mongoose.Schema(
  {
    version: {
      type: Number,
      required: true,
      min: 1,
      unique: true
    },

    status: {
      type: String,
      required: true,
      enum: ['draft', 'active', 'archived'],
      default: 'draft'
    },

    general: {
      baseScore: {
        type: Number,
        required: true
      },

      minimumScore: {
        type: Number,
        required: true
      },

      maximumScore: {
        type: Number,
        required: true
      }
    },

    patterns: {
      enabled: {
        type: Boolean,
        default: true
      },

      address: {
        enabled: {
          type: Boolean,
          default: true
        },

        mode: {
          type: String,
          enum: ['cumulative', 'exclusive'],
          default: 'exclusive'
        },

        elements: {
          street: {
            type: addressElementSchema,
            required: true
          },

          city: {
            type: addressElementSchema,
            required: true
          },

          governorate: {
            type: addressElementSchema,
            required: true
          },

          postalCode: {
            type: addressElementSchema,
            required: true
          }
        },

        levels: {
          type: [addressLevelSchema],
          default: []
        }
      },

      geographicZone: {
        enabled: {
          type: Boolean,
          default: true
        },

        rules: {
          type: [geographicRuleSchema],
          default: []
        }
      },

      orderValue: {
        enabled: {
          type: Boolean,
          default: true
        },

        relativeToHistory: {
          enabled: {
            type: Boolean,
            default: true
          },

          minimumHistoricalOrders: {
            type: Number,
            default: 0,
            min: 0
          },

          rules: {
            type: [rangeRuleSchema],
            default: []
          }
        },

        absoluteValue: {
          enabled: {
            type: Boolean,
            default: true
          },

          rules: {
            type: [rangeRuleSchema],
            default: []
          }
        }
      },

      orderTime: {
        enabled: {
          type: Boolean,
          default: true
        },

        rules: {
          type: [timeRuleSchema],
          default: []
        },

        historicalSignal: {
          enabled: {
            type: Boolean,
            default: true
          },

          minimumCompletedOrders: {
            type: Number,
            default: 0,
            min: 0
          },

          minimumFailureRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
          },

          minimumExcessFailureRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
          },

          impact: {
            type: Number,
            required: true
          }
        }
      }
    },

    customerHistory: {
      enabled: {
        type: Boolean,
        default: true
      },

      successfulDeliveries: {
        enabled: {
          type: Boolean,
          default: true
        },

        rules: {
          type: [rangeRuleSchema],
          default: []
        }
      },

      failedDeliveries: {
        enabled: {
          type: Boolean,
          default: true
        },

        rules: {
          type: [rangeRuleSchema],
          default: []
        }
      }
    },

    operatorFeedback: {
      enabled: {
        type: Boolean,
        default: true
      },

      categories: {
        type: [feedbackCategorySchema],
        default: []
      },

      questions: {
        type: [feedbackQuestionSchema],
        default: []
      }
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
    },

    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// ==========================================================
// VALIDATION
// ==========================================================

aiScoringConfigSchema.pre('validate', function validateGeneralScore(next) {
  const general = this.general || {};

  if (
    Number.isFinite(general.minimumScore) &&
    Number.isFinite(general.maximumScore) &&
    general.minimumScore > general.maximumScore
  ) {
    return next(
      new Error(
        'minimumScore cannot be greater than maximumScore'
      )
    );
  }

  if (
    Number.isFinite(general.baseScore) &&
    Number.isFinite(general.minimumScore) &&
    general.baseScore < general.minimumScore
  ) {
    return next(
      new Error(
        'baseScore cannot be lower than minimumScore'
      )
    );
  }

  if (
    Number.isFinite(general.baseScore) &&
    Number.isFinite(general.maximumScore) &&
    general.baseScore > general.maximumScore
  ) {
    return next(
      new Error(
        'baseScore cannot be greater than maximumScore'
      )
    );
  }

  next();
});

// ==========================================================
// INDEXES
// ==========================================================

aiScoringConfigSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'active'
    },
    name: 'one_active_ai_scoring_config'
  }
);

aiScoringConfigSchema.index({
  createdAt: -1
});

// ==========================================================
// EXPORT
// ==========================================================

module.exports = mongoose.model(
  'AIScoringConfig',
  aiScoringConfigSchema
);
