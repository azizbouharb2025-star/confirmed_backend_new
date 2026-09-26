const axios =
  require('axios');

const Order =
  require('../../models/Order');

const DeliveryShipment =
  require('../../models/DeliveryShipment');

const DeliveryIntegration =
  require('../../models/DeliveryIntegration');

const {
  resolveColissimoOrderStatus
} =
  require('../carrierStatusMappingService');

const {
  emitOrderUpdate
} = require('../../websocket/orderEvents');

const TRACKING_URL =
  'https://colissimodelivery.tn/api/v1/etat.php';

/*
 * Mapping STRICTEMENT Colissimo.
 * Aucun statut inconnu ne modifie automatiquement la commande.
 */
const normalizeColissimoStatus = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/*
 * Traduit uniquement les statuts Colissimo
 * dont la signification métier est suffisamment claire.
 *
 * Les états ambigus/techniques restent conservés dans
 * DeliveryShipment mais ne modifient pas automatiquement
 * Order.status.
 */
const mapColissimoOrderStatus = value => {
  const status =
    normalizeColissimoStatus(value);

  if (
    [
      'livre',
      'livre paye'
    ].includes(status)
  ) {
    return 'delivered';
  }

  /*
   * Dépôt initial OU retour au dépôt après
   * une tentative de livraison.
   *
   * Important :
   * Retour dépôt !== retour définitif expéditeur.
   */
  if (
    [
      'au depot',
      'retour depot'
    ].includes(status)
  ) {
    return 'at_depot';
  }

  if (status === 'en cours') {
    return 'out_for_delivery';
  }

  /*
   * Véritable processus de retour vers l'expéditeur.
   */
  if (
    [
      'retour expediteur',
      'retour inter agence',
      'retour paye',
      'retour definitif',
      'retour recu paye'
    ].includes(status)
  ) {
    return 'returned';
  }

  /*
   * En attente / Echange / Supprime / Non recu /
   * A enlever / Enleve / A verifier / Inconnu
   * et tout futur statut inconnu :
   * aucune mutation automatique du statut métier.
   */
  return null;
};


/*
 * Le cycle logistique n'est pas strictement linéaire.
 *
 * Une tentative peut revenir au dépôt puis repartir
 * en livraison. Une ancienne commande marquée
 * failed_delivery par l'ancien mapping doit également
 * pouvoir être réalignée avec le nouveau workflow.
 */
const evaluateColissimoOrderTransition = (
  currentStatus,
  proposedStatus
) => {
  if (!proposedStatus) {
    return {
      eligible: false,
      reason:
        'provider_status_does_not_change_order'
    };
  }

  if (currentStatus === proposedStatus) {
    return {
      eligible: false,
      reason:
        'already_aligned'
    };
  }

  /*
   * Une livraison réellement terminée ainsi que les
   * annulations/rejets restent terminales.
   */
  if (
    [
      'delivered',
      'cancelled',
      'rejected'
    ].includes(currentStatus)
  ) {
    return {
      eligible: false,
      reason:
        'local_status_is_terminal'
    };
  }

  const allowed = {
    confirmed: [
      'at_depot',
      'out_for_delivery',
      'delivered',
      'returned'
    ],

    shipped: [
      'at_depot',
      'out_for_delivery',
      'delivered',
      'returned'
    ],

    at_depot: [
      'out_for_delivery',
      'delivered',
      'returned'
    ],

    out_for_delivery: [
      'at_depot',
      'delivered',
      'returned'
    ],

    /*
     * Le transporteur peut réellement remettre
     * un colis en circulation après un événement
     * précédemment interprété comme retour.
     */
    returned: [
      'at_depot',
      'out_for_delivery',
      'delivered'
    ],

    /*
     * Compatibilité avec les commandes créées
     * avant le nouveau mapping.
     */
    failed_delivery: [
      'at_depot',
      'out_for_delivery',
      'delivered',
      'returned'
    ]
  };

  if (
    !allowed[currentStatus]
      ?.includes(proposedStatus)
  ) {
    return {
      eligible: false,
      reason:
        'transition_not_allowed'
    };
  }

  return {
    eligible: true,
    reason:
      'transition_allowed'
  };
};


const syncColissimoShipmentStatus =
  async ({
    shopId,
    orderId
  }) => {
    const order =
      await Order.findOne({
        _id: orderId,
        shopId
      });

    if (!order) {
      const error =
        new Error(
          'Commande introuvable'
        );

      error.statusCode = 404;
      throw error;
    }

    const shipment =
      await DeliveryShipment.findOne({
        orderId,
        shopId,
        provider: 'colissimo'
      });

    if (
      !shipment ||
      !shipment.externalId
    ) {
      const error =
        new Error(
          'Aucun colis Colissimo créé pour cette commande'
        );

      error.statusCode = 404;
      throw error;
    }

    const integration =
      await DeliveryIntegration.findOne({
        shopId,
        platform: 'colissimo',
        isActive: true
      }).lean();

    const trackingToken =
      String(
        integration
          ?.credentials
          ?.trackingToken ||
        ''
      ).trim();

    if (!trackingToken) {
      const error =
        new Error(
          'Token de tracking Colissimo non configuré'
        );

      error.statusCode = 409;
      throw error;
    }

    const body =
      new URLSearchParams();

    body.set(
      'token',
      trackingToken
    );

    body.set(
      'code',
      String(
        shipment.externalId
      )
    );

    const response =
      await axios.post(
        TRACKING_URL,
        body.toString(),
        {
          timeout: 15000,
          headers: {
            Accept:
              'application/json',

            'Content-Type':
              'application/x-www-form-urlencoded'
          }
        }
      );

    const data =
      response.data || {};

    const success =
      data.status === 1 ||
      data.status === '1';

    if (!success) {
      const error =
        new Error(
          String(
            data.status_message ||
            'Colissimo tracking rejected'
          )
        );

      error.statusCode = 400;
      throw error;
    }

    const providerStatus =
      String(
        data.etat ||
        'Inconnu'
      ).trim();

    const mappingResolution =
      await resolveColissimoOrderStatus({
        statusValue:
          providerStatus,

        /*
         * Sécurité :
         * tant qu'aucune configuration Admin
         * n'est active, ou si MongoDB rencontre
         * temporairement une erreur, on conserve
         * exactement le mapping Colissimo actuel.
         */
        fallbackResolver:
          mapColissimoOrderStatus
      });

    const proposedOrderStatus =
      mappingResolution.orderStatus;

    const previousProviderStatusLabel =
      shipment.providerStatusLabel ||
      null;

    const previousProviderStatusCode =
      shipment.providerStatusCode;

    shipment.providerStatusCode =
      data.status;

    shipment.providerStatusLabel =
      providerStatus;

    shipment.metadata = {
      ...(shipment.metadata || {}),

      tracking: {
        etat:
          providerStatus,

        motif:
          data.motif || '',

        preEtat:
          data.pre_etat || '',

        preMotif:
          data.pre_motif || '',

        syncedAt:
          new Date()
      }
    };

    /*
     * Historique transporteur :
     * on ajoute une entrée uniquement lorsque
     * l'état Colissimo change réellement.
     *
     * Les synchronisations répétées du même état
     * ne polluent donc pas l'historique.
     */
    const providerStatusChanged =
      previousProviderStatusLabel !==
        providerStatus ||
      String(previousProviderStatusCode ?? '') !==
        String(data.status ?? '');

    if (providerStatusChanged) {
      shipment.providerStatusHistory.push({
        code:
          data.status,

        label:
          providerStatus,

        mappedOrderStatus:
          proposedOrderStatus ||
          undefined,

        occurredAt:
          new Date(),

        rawEvent: {
          status:
            data.status,

          statusMessage:
            data.status_message || '',

          etat:
            providerStatus,

          motif:
            data.motif || '',

          preEtat:
            data.pre_etat || '',

          preMotif:
            data.pre_motif || ''
        }
      });
    }

    shipment.lastError =
      undefined;

    await shipment.save();

    const transition =
      evaluateColissimoOrderTransition(
        order.status,
        proposedOrderStatus
      );

    /*
     * Historique métier CONFIRMED.
     *
     * On ne mélange pas le statut technique Colissimo
     * avec le statut simplifié affiché au vendeur.
     */
    if (transition.eligible) {
      const previousOrderStatus =
        order.status;

      const changedAt =
        new Date();

      /*
       * Mise à jour atomique :
       * le statut doit toujours être celui que nous avons
       * lu avant l'appel Colissimo.
       *
       * Ainsi, un autre worker ne peut pas être écrasé.
       */
      const updatedOrder =
        await Order.findOneAndUpdate(
          {
            _id:
              order._id,

            shopId,

            status:
              previousOrderStatus
          },

          {
            $set: {
              status:
                proposedOrderStatus
            },

            $push: {
              statusHistory: {
                status:
                  proposedOrderStatus,

                timestamp:
                  changedAt,

                source:
                  'courier',

                reason:
                  `Synchronisation Colissimo : ${providerStatus}`,

                notes:
                  data.motif ||
                  `Statut précédent : ${previousOrderStatus}`
              }
            }
          },

          {
            new:
              true
          }
        );

      /*
       * Mise à jour temps réel uniquement lorsque
       * MongoDB a réellement appliqué la transition.
       */
      if (updatedOrder) {
        emitOrderUpdate(
          updatedOrder
        );
      }
    }

    return {
      success: true,

      provider:
        'colissimo',

      orderId:
        String(order._id),

      externalId:
        shipment.externalId,

      status:
        providerStatus,

      motif:
        data.motif || '',

      previousStatus:
        data.pre_etat || '',

      previousMotif:
        data.pre_motif || ''
    };
  };

module.exports = {
  syncColissimoShipmentStatus
};
