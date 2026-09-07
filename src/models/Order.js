const mongoose = require('mongoose');
const Counter = require('./Counter');

const orderSchema = new mongoose.Schema({
  // Identifiant global interne CONFIRMED.
  // Affiché dans l'interface sous la forme #1, #2, #3...
  confirmedId: {
    type: Number,
    min: 1,
    immutable: true
  },

  // Référence originale provenant de la boutique, du CMS ou du fichier importé.
  externalOrderId: {
    type: String,
    trim: true
  },

  // Champ historique conservé temporairement pour compatibilité avec
  // les intégrations, exports et services existants.
  orderId: {
    type: String
  },
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  clientInfo: {
    name: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    },

    // Numéros supplémentaires fournis/corrigés pendant l'appel opérateur.
    // Le téléphone principal reste clientInfo.phone.
    additionalPhones: [{
      type: String,
      trim: true
    }],

    email: String,
    address: {
      street: String,
      city: String,
      state: String,
      district: String,
      zipCode: String,
      country: String
    }
  },
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    name: String,
    quantity: Number,
    price: Number,
    sku: String,
    url: String
  }],

  // Frais appliqués à cette commande.
  // Ils sont indépendants du deliveryFee par défaut du catalogue produit.
  deliveryFee: {
    type: Number,
    min: 0,
    default: 0
  },

  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_progress', 'confirmed', 'rejected', 'cancelled', 'postponed', 'shipped', 'delivered', 'failed_delivery'],
    default: 'pending'
  },
  deliveryInfo: {
    estimatedDate: Date,
    trackingNumber: String,
    carrier: String,
    secondaryPhone: String,
    packageCount: Number,
    comment: String,
    weight: Number,
    colissimoType: {
      type: String,
      enum: ['VO', 'VM', 'GV', 'EXP', 'FIX', 'ONP', 'BLK', 'SMD']
    }
  },
  assignedOperatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  /*
   * Informations de report / rappel opérateur.
   *
   * date et time conservent la saisie utilisateur.
   * scheduledFor est la date UTC utilisée par la File
   * d'attente pour réinsérer automatiquement la commande.
   */
  postponement: {
    date: {
      type: String,
      trim: true
    },
    time: {
      type: String,
      trim: true,
      default: ''
    },
    scheduledFor: {
      type: Date
    },
    note: {
      type: String,
      trim: true,
      default: ''
    },
    postponedAt: {
      type: Date
    },
    postponedByOperatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  callHistory: [{
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    callType: {
      type: String,
      enum: ['human', 'ai']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    duration: Number,

    // Numéro de tentative de contact opérateur.
    // 1, 2 ou 3 uniquement pour les tentatives infructueuses.
    attemptNumber: {
      type: Number,
      min: 1,
      max: 3
    },

    result: {
      type: String,
      enum: [
        'confirmed',
        'rejected',
        'no_answer',
        'busy',
        'unreachable',
        'callback_requested',
        'interrupted',
        'other'
      ]
    },

    // Motif structuré de la tentative.
    attemptReason: {
      type: String,
      enum: [
        'no_answer',
        'busy',
        'unreachable',
        'callback_requested',
        'interrupted',
        'other'
      ]
    },

    notes: String,

    /*
     * Snapshot du retour opérateur au moment de l'appel.
     * La version structurée principale reste operatorFeedback.
     */
    feedback: {
      type: mongoose.Schema.Types.Mixed
    }
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },

  // Pro tier fields
  aiRiskScore: {
    type: Number,
    min: 0,
    max: 100
  },
  aiScore: {
    type: Number,
    min: 0,
    max: 100,
    description: "AI confidence score for order validity (0-100%)"
  },
  riskLevel: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low', 'very_low'],
    description: "Risk level based on AI score"
  },

  aiScoredAt: {
    type: Date,
    description: "Date and time when the AI score was calculated"
  },

  aiDecision: {
    type: String,
    enum: ['accept', 'review', 'reject'],
    description: "Decision derived from the AI score"
  },

  aiScoreDetails: {
    baseScore: Number,
    finalScore: Number,
    factors: [{
      key: String,
      label: String,
      value: mongoose.Schema.Types.Mixed,
      impact: Number,
      applied: Boolean
    }]
  },
  deliverySuccessProbability: {
    type: Number,
    min: 0,
    max: 100,
    description: "Probability of successful delivery"
  },
  /*
   * Retour comportemental structuré de l'opérateur.
   *
   * confidence est conservé uniquement pour compatibilité
   * avec les anciennes analyses déjà présentes.
   */
  operatorFeedback: {
    confidence: {
      type: String,
      enum: ['strong', 'doubtful', 'neutral']
    },

    toneSignals: [{
      type: String,
      enum: [
        'polite',
        'confident',
        'enthusiastic',
        'quick_response',
        'hesitant',
        'distracted',
        'long_pauses',
        'rude',
        'aggressive',
        'nervous',
        'low_interest'
      ]
    }],

    confirmationLevel: {
      type: String,
      enum: [
        'very_firm',
        'normal',
        'weak'
      ]
    },

    priceBehavior: {
      type: String,
      enum: [
        'no_issue',
        'asks_discount',
        'insists_discount',
        'strong_negotiation'
      ]
    },

    productDoubts: {
      type: String,
      enum: [
        'none',
        'asks_question',
        'multiple_doubts',
        'compares_seller'
      ]
    },

    deliveryInformation: {
      type: String,
      enum: [
        'complete_quick',
        'clear_precise',
        'partial',
        'vague',
        'difficulty',
        'refuses_details'
      ]
    },

    engagementLevel: {
      type: String,
      enum: [
        'very_engaged',
        'interested',
        'passive',
        'low_involvement',
        'distracted'
      ]
    },

    receptionIntent: {
      type: String,
      enum: [
        'wants_fast_delivery',
        'clearly_confirms_receipt',
        'asks_delivery_info',
        'uncertain_receipt',
        'does_not_know_when'
      ]
    },

    notes: {
      type: String,
      default: ''
    },

    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    submittedAt: {
      type: Date
    }
  },

  confirmedAt: {
    type: Date
  },

  confirmedByOperatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Business tier fields
  courierAssignment: {
    courierId: String,
    courierName: String,
    assignedAt: Date
  },
  courier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Courier',
    description: "Assigned courier/delivery company"
  },
  region: {
    type: String,
    description: "Delivery region"
  },
  complaintFlags: [{
    type: String
  }],
  hasComplaint: {
    type: Boolean,
    default: false,
    description: "Flag indicating if order has associated complaints"
  },
  cancellationReason: {
    type: String,
    enum: [
      'customer_refused',
      'price_too_high',
      'quality_doubts',
      'duplicate_order',
      'fake_number',
      'not_available',
      'courier_failed',
      'customer_rejected_at_door',
      'unreachable_after_3_attempts'
    ],
    description: "Reason for order cancellation"
  },
  cancellationReasonDetails: {
    type: String,
    description: "Additional details about cancellation"
  },
  cancelledBy: {
    type: String,
    enum: ['customer', 'operator', 'system', 'courier'],
    description: "Who cancelled the order"
  },

  cancelledAt: {
    type: Date
  },

  cancelledByOperatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Historique des changements importants de statut.
  statusHistory: [{
    status: {
      type: String,
      enum: [
        'pending',
        'assigned',
        'in_progress',
        'confirmed',
        'rejected',
        'cancelled',
        'postponed',
        'shipped',
        'delivered',
        'failed_delivery'
      ]
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    source: {
      type: String,
      enum: ['operator', 'system', 'customer', 'courier']
    },
    reason: String,
    notes: String
  }],

  deliveryAttempts: [{
    attemptNumber: Number,
    attemptDate: Date,
    status: {
      type: String,
      enum: ['failed', 'customer_not_home', 'refused', 'successful']
    },
    notes: String
  }],

  // Enterprise tier fields
  isRepeatBuyer: {
    type: Boolean,
    default: false
  },
  customerLifetimeValue: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Attribution atomique de l'identifiant global CONFIRMED.
// Le compteur MongoDB garantit qu'une seule commande peut recevoir
// un numéro donné, même avec plusieurs instances PM2 ou créations simultanées.
orderSchema.pre('save', async function () {
  if (!this.isNew) {
    return;
  }

  if (!this.confirmedId) {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'order' },
      { $inc: { seq: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    this.confirmedId = counter.seq;
  }

  // Si un ancien orderId est fourni par Shopify/CMS/import,
  // on le conserve également comme référence externe.
  if (!this.externalOrderId && this.orderId) {
    this.externalOrderId = String(this.orderId);
  }

  // Compatibilité temporaire pour les créations sans référence externe.
  // Ce champ pourra être retiré lorsque tout le code utilisera confirmedId.
  if (!this.orderId) {
    this.orderId = `CONF-${this.confirmedId}`;
  }
});

orderSchema.index(
  { confirmedId: 1 },
  {
    unique: true,
    sparse: true,
    name: 'confirmed_id_unique'
  }
);

orderSchema.index({ shopId: 1, status: 1 });
orderSchema.index({ assignedOperatorId: 1 });
orderSchema.index({ orderId: 1, shopId: 1 }, { unique: true });

// Indexes for tier-specific filterable fields
orderSchema.index({ aiRiskScore: 1 });
orderSchema.index({ aiScore: 1 });
orderSchema.index({ riskLevel: 1 });
orderSchema.index({ courier: 1 });
orderSchema.index({ region: 1 });
orderSchema.index({ hasComplaint: 1 });
orderSchema.index({ 'courierAssignment.courierName': 1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);