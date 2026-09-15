const axios =
  require('axios');

const Order =
  require('../../models/Order');

const DeliveryShipment =
  require('../../models/DeliveryShipment');

const DeliveryIntegration =
  require('../../models/DeliveryIntegration');

const TRACKING_URL =
  'https://colissimodelivery.tn/api/v1/etat.php';

/*
 * Mapping STRICTEMENT Colissimo.
 * Aucun statut inconnu ne modifie automatiquement la commande.
 */
const mapColissimoOrderStatus = value => {
  const status =
    String(value || '').trim();

  if (
    [
      'Livre',
      'Livre paye'
    ].includes(status)
  ) {
    return 'delivered';
  }

  if (
    [
      'En cours',
      'Au depot'
    ].includes(status)
  ) {
    return 'shipped';
  }

  if (
    [
      'Non recu',
      'Retour Expediteur',
      'Retour Inter Agence',
      'Retour depot',
      'Retour paye',
      'Retour definitif',
      'Retour recu paye'
    ].includes(status)
  ) {
    return 'failed_delivery';
  }

  if (status === 'Supprime') {
    return 'cancelled';
  }

  return null;
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

    shipment.lastError =
      undefined;

    await shipment.save();

    const proposedOrderStatus =
      mapColissimoOrderStatus(
        providerStatus
      );

    /*
     * Ne jamais rétrograder une commande déjà livrée.
     * Les statuts inconnus / ambigus restent sans effet.
     */
    if (
      proposedOrderStatus &&
      !(
        order.status === 'delivered' &&
        proposedOrderStatus !== 'delivered'
      ) &&
      order.status !== proposedOrderStatus
    ) {
      order.status =
        proposedOrderStatus;

      if (
        proposedOrderStatus === 'shipped' &&
        !order.shippedAt
      ) {
        order.shippedAt =
          new Date();
      }

      if (
        proposedOrderStatus === 'delivered' &&
        !order.deliveredAt
      ) {
        order.deliveredAt =
          new Date();
      }

      await order.save();
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
