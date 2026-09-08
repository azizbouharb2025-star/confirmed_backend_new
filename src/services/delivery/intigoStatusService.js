const mongoose =
  require('mongoose');

const Order =
  require('../../models/Order');

const DeliveryShipment =
  require('../../models/DeliveryShipment');

const DeliveryIntegration =
  require('../../models/DeliveryIntegration');

const intigoClient =
  require('./intigoClient');

const {
  emitOrderUpdate
} = require('../../websocket/orderEvents');

/*
 * Mapping STRICTEMENT Intigo.
 *
 * Il ne doit jamais devenir une règle globale
 * imposée aux autres transporteurs.
 */
const mapIntigoStatus = statusValue => {
  const status =
    Number(statusValue);

  if (!Number.isInteger(status)) {
    return {
      known:
        false,

      lifecycle:
        'unknown',

      orderStatus:
        null,

      requiresReview:
        true
    };
  }

  /*
   * Réacheminement :
   * le colis continue son cycle.
   */
  if (status === 99) {
    return {
      known:
        true,

      lifecycle:
        'rerouting',

      orderStatus:
        null,

      requiresReview:
        false
    };
  }

  /*
   * Pickup vendeur.
   *
   * Le colis n'est pas encore considéré
   * comme expédié dans Confirmed.
   */
  if (
    status >= 1000 &&
    status <= 1008
  ) {
    return {
      known:
        true,

      lifecycle:
        'pickup',

      orderStatus:
        null,

      requiresReview:
        false
    };
  }

  /*
   * Annulation pendant pickup.
   */
  if (
    status >= 1100 &&
    status <= 1102
  ) {
    return {
      known:
        true,

      lifecycle:
        'cancelled',

      orderStatus:
        'cancelled',

      requiresReview:
        false
    };
  }

  /*
   * Entrepôt / relance / vérification.
   *
   * Le transporteur possède physiquement
   * le colis : Confirmed => shipped.
   */
  if (
    [
      2000,
      2001,
      2004,
      2100
    ].includes(status)
  ) {
    return {
      known:
        true,

      lifecycle:
        'warehouse',

      orderStatus:
        'shipped',

      requiresReview:
        false
    };
  }

  if (status === 3100) {
    return {
      known:
        true,

      lifecycle:
        'delivery_transfer',

      orderStatus:
        'shipped',

      requiresReview:
        false
    };
  }

  if (status === 3201) {
    return {
      known:
        true,

      lifecycle:
        'return_transfer',

      orderStatus:
        'failed_delivery',

      requiresReview:
        false
    };
  }

  if (status === 4000) {
    return {
      known:
        true,

      lifecycle:
        'out_for_delivery',

      orderStatus:
        'shipped',

      requiresReview:
        false
    };
  }

  if (status === 5000) {
    return {
      known:
        true,

      lifecycle:
        'delivered',

      orderStatus:
        'delivered',

      requiresReview:
        false
    };
  }

  if (
    [
      6000,
      6001,
      6500,
      6900
    ].includes(status)
  ) {
    return {
      known:
        true,

      lifecycle:
        'return',

      orderStatus:
        'failed_delivery',

      requiresReview:
        false
    };
  }

  if (
    status >= 9000 &&
    status <= 9004
  ) {
    return {
      known:
        true,

      lifecycle:
        'cancelled',

      orderStatus:
        'cancelled',

      requiresReview:
        false
    };
  }

  /*
   * Tout nouveau statut Intigo inconnu
   * ne doit jamais modifier Order automatiquement.
   */
  return {
    known:
      false,

    lifecycle:
      'unknown',

    orderStatus:
      null,

    requiresReview:
      true
  };
};

const evaluateOrderTransition = (
  currentStatus,
  proposedStatus
) => {
  if (!proposedStatus) {
    return {
      eligible:
        false,

      reason:
        'provider_status_does_not_change_order'
    };
  }

  if (
    currentStatus ===
    proposedStatus
  ) {
    return {
      eligible:
        false,

      reason:
        'already_aligned'
    };
  }

  /*
   * Statuts terminaux Confirmed :
   * aucune régression automatique.
   */
  if (
    [
      'delivered',
      'cancelled',
      'rejected'
    ].includes(currentStatus)
  ) {
    return {
      eligible:
        false,

      reason:
        'local_status_is_terminal'
    };
  }

  /*
   * Seules les commandes déjà confirmées
   * ou expédiées pourront être synchronisées.
   */
  const allowed = {
    confirmed: [
      'shipped',
      'delivered',
      'failed_delivery',
      'cancelled'
    ],

    shipped: [
      'delivered',
      'failed_delivery',
      'cancelled'
    ]
  };

  if (
    !allowed[currentStatus]
      ?.includes(proposedStatus)
  ) {
    return {
      eligible:
        false,

      reason:
        'transition_not_allowed'
    };
  }

  return {
    eligible:
      true,

    reason:
      'transition_allowed'
  };
};

const getIntigoShipmentStatusPreview =
  async ({
    shopId,
    orderId
  }) => {
    const normalizedOrderId =
      String(orderId || '').trim();

    if (
      !mongoose.Types.ObjectId
        .isValid(normalizedOrderId)
    ) {
      const error =
        new Error(
          'Invalid MongoDB order ID'
        );

      error.statusCode = 400;

      throw error;
    }

    const order =
      await Order.findOne({
        _id:
          normalizedOrderId,

        shopId
      })
        .select({
          confirmedId: 1,
          status: 1,
          deliveryInfo: 1
        })
        .lean();

    if (!order) {
      const error =
        new Error(
          'Order not found or outside this shop'
        );

      error.statusCode = 404;

      throw error;
    }

    const shipment =
      await DeliveryShipment.findOne({
        orderId:
          order._id,

        shopId,

        provider:
          'intigo'
      })
        .lean();

    if (!shipment) {
      const error =
        new Error(
          'Intigo shipment not found'
        );

      error.statusCode = 404;

      throw error;
    }

    if (!shipment.externalId) {
      const error =
        new Error(
          'Intigo shipment has no NID'
        );

      error.statusCode = 409;

      throw error;
    }

    const integration =
      await DeliveryIntegration.findOne({
        shopId,

        platform:
          'intigo',

        isActive:
          true
      })
        .lean();

    if (
      !integration
        ?.credentials
        ?.apiKey
    ) {
      const error =
        new Error(
          'Intigo integration is not ready'
        );

      error.statusCode = 409;

      throw error;
    }

    if (
      integration.settings
        ?.trackingEnabled === false
    ) {
      const error =
        new Error(
          'Intigo tracking is disabled'
        );

      error.statusCode = 409;

      throw error;
    }

    const remote =
      await intigoClient.getParcel({
        apiKey:
          integration
            .credentials
            .apiKey,

        baseUrl:
          integration
            .credentials
            .baseUrl,

        nid:
          shipment.externalId
      });

    const parcel =
      remote.data?.parcel;

    if (
      remote.data?.success !== true ||
      !parcel
    ) {
      const error =
        new Error(
          'Unexpected Intigo parcel response'
        );

      error.statusCode = 502;

      throw error;
    }

    const remoteNid =
      String(
        parcel.nid || ''
      ).trim();

    const remoteCid =
      String(
        parcel.cid || ''
      ).trim();

    if (
      remoteNid !==
      String(shipment.externalId)
    ) {
      const error =
        new Error(
          'Intigo NID mismatch'
        );

      error.statusCode = 409;

      throw error;
    }

    if (
      shipment.correlationId &&
      remoteCid &&
      remoteCid !==
        shipment.correlationId
    ) {
      const error =
        new Error(
          'Intigo CID mismatch'
        );

      error.statusCode = 409;

      throw error;
    }

    const mapping =
      mapIntigoStatus(
        parcel.status
      );

    const transition =
      evaluateOrderTransition(
        order.status,
        mapping.orderStatus
      );

    return {
      success:
        true,

      provider:
        'intigo',

      readOnly:
        true,

      remoteCall:
        {
          method:
            'GET',

          resource:
            '/parcels/{nid}',

          performed:
            true
        },

      local: {
        orderId:
          String(order._id),

        confirmedId:
          order.confirmedId,

        orderStatus:
          order.status,

        shipmentState:
          shipment.state,

        nid:
          shipment.externalId,

        cid:
          shipment.correlationId ||
          null,

        storedProviderStatusCode:
          shipment.providerStatusCode ??
          null,

        storedProviderStatusLabel:
          shipment.providerStatusLabel ??
          null
      },

      intigo: {
        nid:
          remoteNid,

        cid:
          remoteCid || null,

        status:
          Number(parcel.status),

        statusLabel:
          parcel.status_label ||
          null,

        isDelivered:
          Boolean(
            parcel.is_delivered
          ),

        isReturn:
          Boolean(
            parcel.is_return
          ),

        deliveryAttempts:
          Number(
            parcel.delivery_attempts ||
            0
          ),

        updatedAt:
          parcel.updated_at ||
          null
      },

      mapping: {
        knownStatus:
          mapping.known,

        lifecycle:
          mapping.lifecycle,

        proposedOrderStatus:
          mapping.orderStatus,

        requiresReview:
          mapping.requiresReview,

        syncEligible:
          transition.eligible,

        syncReason:
          transition.reason
      }
    };
  };


/*
 * Synchronisation EXPLICITE Intigo -> Confirmed.
 *
 * IMPORTANT :
 * - appel distant = GET uniquement
 * - aucun changement chez Intigo
 * - providerStatus toujours mémorisé
 * - Order change uniquement si mapping autorisé
 * - transition Order atomique pour résister
 *   aux doubles clics / workers PM2
 */
const syncIntigoShipmentStatus =
  async ({
    shopId,
    orderId
  }) => {
    /*
     * Le preview refait toutes les vérifications :
     * ownership, NID, CID, intégration, réponse Intigo,
     * mapping et transition.
     */
    const preview =
      await getIntigoShipmentStatusPreview({
        shopId,
        orderId
      });

    const syncedAt =
      new Date();

    const previousProviderStatusCode =
      preview.local
        .storedProviderStatusCode;

    const previousProviderStatusLabel =
      preview.local
        .storedProviderStatusLabel;

    const currentProviderStatusCode =
      preview.intigo.status;

    const currentProviderStatusLabel =
      preview.intigo.statusLabel ||
      null;

    const sameCode =
      (
        previousProviderStatusCode == null &&
        currentProviderStatusCode == null
      ) ||
      String(
        previousProviderStatusCode
      ) ===
        String(
          currentProviderStatusCode
        );

    const sameLabel =
      String(
        previousProviderStatusLabel ||
        ''
      ) ===
      String(
        currentProviderStatusLabel ||
        ''
      );

    const providerStatusChanged =
      !sameCode ||
      !sameLabel;

    /*
     * 1. Toujours enregistrer le snapshot transporteur.
     *
     * DeliveryShipment.state reste "created".
     * On ne transforme PAS un retour/cancel Intigo
     * en state=cancelled, car cet état local est utilisé
     * par le moteur de réservation/retry.
     */
    const shipment =
      await DeliveryShipment
        .findOneAndUpdate(
          {
            orderId:
              preview.local.orderId,

            shopId,

            provider:
              'intigo',

            externalId:
              preview.local.nid
          },

          {
            $set: {
              providerStatusCode:
                currentProviderStatusCode,

              providerStatusLabel:
                currentProviderStatusLabel,

              'metadata.lastStatusSyncAt':
                syncedAt,

              'metadata.intigoLifecycle':
                preview.mapping.lifecycle,

              'metadata.intigoIsDelivered':
                preview.intigo.isDelivered,

              'metadata.intigoIsReturn':
                preview.intigo.isReturn,

              'metadata.intigoDeliveryAttempts':
                preview.intigo
                  .deliveryAttempts,

              'metadata.intigoUpdatedAt':
                preview.intigo.updatedAt ||
                null
            }
          },

          {
            new:
              true
          }
        )
        .lean();

    if (!shipment) {
      const error =
        new Error(
          'Intigo shipment disappeared during synchronization'
        );

      error.statusCode = 409;

      throw error;
    }

    let orderChanged =
      false;

    let racePrevented =
      false;

    let orderAfter =
      preview.local.orderStatus;

    /*
     * 2. Changer Order uniquement lorsque
     * evaluateOrderTransition l'autorise.
     */
    if (
      preview.mapping.syncEligible
    ) {
      const nextStatus =
        preview.mapping
          .proposedOrderStatus;

      const reason =
        `Intigo ${preview.intigo.status}` +
        (
          preview.intigo.statusLabel
            ? ` - ${preview.intigo.statusLabel}`
            : ''
        );

      const setFields = {
        status:
          nextStatus
      };

      /*
       * Métadonnées métier d'annulation.
       * Aucun cancellationReason spécifique n'est inventé :
       * l'API Intigo possède plusieurs sous-types.
       */
      if (
        nextStatus ===
        'cancelled'
      ) {
        setFields.cancelledBy =
          'courier';

        setFields.cancelledAt =
          syncedAt;
      }

      /*
       * Filtrer AUSSI par ancien statut garantit :
       * deux sync simultanées ne peuvent pas ajouter
       * deux lignes statusHistory identiques.
       */
      const updatedOrder =
        await Order.findOneAndUpdate(
          {
            _id:
              preview.local.orderId,

            shopId,

            status:
              preview.local.orderStatus
          },

          {
            $set:
              setFields,

            $push: {
              statusHistory: {
                status:
                  nextStatus,

                timestamp:
                  syncedAt,

                source:
                  'courier',

                reason,

                notes:
                  `Intigo NID ${preview.intigo.nid}`
              }
            }
          },

          {
            new:
              true
          }
        );

      if (updatedOrder) {
        orderChanged =
          true;

        orderAfter =
          updatedOrder.status;

        /*
         * Mettre à jour l'interface temps réel
         * uniquement si Order a réellement changé.
         */
        emitOrderUpdate(
          updatedOrder
        );
      } else {
        /*
         * Un autre worker/process a pu modifier Order
         * après notre GET Intigo.
         *
         * On ne force jamais l'écriture.
         */
        racePrevented =
          true;

        const currentOrder =
          await Order.findOne({
            _id:
              preview.local.orderId,

            shopId
          })
            .select(
              'status'
            )
            .lean();

        orderAfter =
          currentOrder?.status ||
          null;
      }
    }

    return {
      success:
        true,

      provider:
        'intigo',

      readOnly:
        false,

      remoteMutationPerformed:
        false,

      remoteCall: {
        method:
          'GET',

        resource:
          '/parcels/{nid}'
      },

      syncedAt,

      shipment: {
        orderId:
          preview.local.orderId,

        confirmedId:
          preview.local.confirmedId,

        state:
          shipment.state,

        nid:
          shipment.externalId,

        cid:
          shipment.correlationId,

        previousProviderStatusCode:
          previousProviderStatusCode ??
          null,

        previousProviderStatusLabel:
          previousProviderStatusLabel ??
          null,

        providerStatusCode:
          shipment.providerStatusCode,

        providerStatusLabel:
          shipment.providerStatusLabel ||
          null,

        providerStatusChanged
      },

      intigo:
        preview.intigo,

      mapping:
        preview.mapping,

      order: {
        before:
          preview.local.orderStatus,

        after:
          orderAfter,

        changed:
          orderChanged,

        racePrevented
      }
    };
  };


module.exports = {
  mapIntigoStatus,
  evaluateOrderTransition,
  getIntigoShipmentStatusPreview,
  syncIntigoShipmentStatus
};
