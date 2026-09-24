const mongoose = require('mongoose');

const deliveryShipmentSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true,
    index: true
  },

  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },

  /*
   * Identifiant canonique du transporteur.
   * Ne pas mettre de règles spécifiques Intigo dans ce modèle.
   */
  provider: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },

  /*
   * Référence Confirmed envoyée au transporteur.
   * Exemple Intigo : CONF-116 via le champ cid.
   */
  correlationId: {
    type: String,
    trim: true
  },

  /*
   * Identifiant attribué par le transporteur.
   * Exemple Intigo : nid.
   */
  externalId: {
    type: String,
    trim: true
  },

  /*
   * preparing :
   *   réservation locale créée AVANT l'appel transporteur.
   *
   * created :
   *   le transporteur a confirmé la création.
   *
   * failed :
   *   appel ou validation transporteur échoué.
   *
   * cancelled :
   *   expédition annulée.
   */
  state: {
    type: String,
    enum: [
      'preparing',
      'dispatching',
      'created',
      'failed',
      'cancelled',
      'reconcile_required'
    ],
    default: 'preparing',
    required: true
  },

  providerStatusCode: {
    type: mongoose.Schema.Types.Mixed
  },

  providerStatusLabel: {
    type: String,
    trim: true
  },

  /*
   * Historique brut des statuts retournés par le transporteur.
   *
   * providerStatusCode / providerStatusLabel restent
   * le dernier état connu.
   *
   * providerStatusHistory conserve la chronologie complète
   * nécessaire au suivi et à l'audit.
   */
  providerStatusHistory: [{
    code: {
      type: mongoose.Schema.Types.Mixed
    },

    label: {
      type: String,
      trim: true
    },

    mappedOrderStatus: {
      type: String,
      trim: true
    },

    occurredAt: {
      type: Date,
      default: Date.now
    },

    rawEvent: {
      type: mongoose.Schema.Types.Mixed
    }
  }],

  /*
   * Métadonnées non sensibles propres au transporteur.
   * Ex. Intigo :
   * {
   *   districtName,
   *   districtFallback
   * }
   */
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  lastError: {
    message: String,
    code: mongoose.Schema.Types.Mixed,
    at: Date
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  /*
   * Verrou temporaire utilisé avant l'appel transporteur.
   * Permet de résister aux doubles clics et aux 4 workers PM2.
   */
  reservationId: {
    type: String,
    trim: true
  },

  reservedAt: {
    type: Date
  },

  reservationExpiresAt: {
    type: Date
  },

  /*
   * Dès que dispatchStartedAt existe et que state=dispatching,
   * un appel transporteur a pu commencer.
   *
   * Cet état ne doit JAMAIS expirer automatiquement vers un retry.
   */
  dispatchStartedAt: {
    type: Date
  },

  /*
   * Empreinte exacte du payload envoyé au transporteur.
   * Ne contient aucune donnée client en clair.
   */
  payloadHash: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

/*
 * Une commande ne peut avoir qu'une réservation active
 * par transporteur dans ce modèle.
 *
 * Les retries d'un échec réutiliseront le même document
 * au lieu de créer une deuxième expédition.
 */
deliveryShipmentSchema.index(
  {
    orderId: 1,
    provider: 1
  },
  {
    unique: true,
    name: 'delivery_order_provider_unique'
  }
);

/*
 * Un NID / tracking externe ne doit pas être associé
 * deux fois au même transporteur.
 */
deliveryShipmentSchema.index(
  {
    provider: 1,
    externalId: 1
  },
  {
    unique: true,
    partialFilterExpression: {
      externalId: {
        $type: 'string'
      }
    },
    name: 'delivery_provider_external_unique'
  }
);

deliveryShipmentSchema.index(
  {
    shopId: 1,
    provider: 1,
    state: 1
  },
  {
    name: 'delivery_shop_provider_state'
  }
);

module.exports = mongoose.model(
  'DeliveryShipment',
  deliveryShipmentSchema
);
