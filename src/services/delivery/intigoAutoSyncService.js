const DeliveryShipment =
  require('../../models/DeliveryShipment');

const {
  syncIntigoShipmentStatus
} = require('./intigoStatusService');

const TERMINAL_CODES =
  new Set([
    1100,
    1101,
    1102,

    5000,

    6900,

    9000,
    9001,
    9002,
    9003,
    9004
  ]);

const isTerminalIntigoStatus =
  value => {
    const status =
      Number(value);

    return (
      Number.isInteger(status) &&
      TERMINAL_CODES.has(status)
    );
  };

const normalizeLimit =
  value => {
    const parsed =
      Number(value);

    if (
      !Number.isInteger(parsed) ||
      parsed < 1
    ) {
      return 25;
    }

    return Math.min(
      parsed,
      100
    );
  };

/*
 * Synchronise un lot d'expéditions Intigo.
 *
 * IMPORTANT :
 * - syncIntigoShipmentStatus effectue un GET Intigo
 * - aucune mutation distante
 * - traitement séquentiel volontaire pour ne pas
 *   envoyer une rafale de requêtes au transporteur
 */
const runIntigoStatusSyncBatch =
  async ({
    limit = 25
  } = {}) => {
    const safeLimit =
      normalizeLimit(limit);

    const shipments =
      await DeliveryShipment.find({
        provider:
          'intigo',

        state:
          'created',

        externalId: {
          $exists:
            true,

          $nin: [
            null,
            ''
          ]
        },

        $or: [
          {
            'metadata.intigoTrackingCompletedAt': {
              $exists:
                false
            }
          },

          {
            'metadata.intigoTrackingCompletedAt':
              null
          }
        ]
      })
        .sort({
          'metadata.lastStatusSyncAt':
            1,

          createdAt:
            1
        })
        .limit(
          safeLimit
        )
        .select({
          _id: 1,
          shopId: 1,
          orderId: 1,
          externalId: 1,
          providerStatusCode: 1
        })
        .lean();

    const summary = {
      selected:
        shipments.length,

      synced:
        0,

      providerStatusChanged:
        0,

      orderChanged:
        0,

      completedTracking:
        0,

      errors:
        0
    };

    const errors = [];

    for (
      const shipment
      of shipments
    ) {
      try {
        const result =
          await syncIntigoShipmentStatus({
            shopId:
              shipment.shopId,

            orderId:
              shipment.orderId
          });

        summary.synced +=
          1;

        if (
          result.shipment
            ?.providerStatusChanged
        ) {
          summary.providerStatusChanged +=
            1;
        }

        if (
          result.order
            ?.changed
        ) {
          summary.orderChanged +=
            1;
        }

        const currentStatus =
          result.shipment
            ?.providerStatusCode;

        if (
          isTerminalIntigoStatus(
            currentStatus
          )
        ) {
          const completedAt =
            new Date();

          await DeliveryShipment.updateOne(
            {
              _id:
                shipment._id,

              provider:
                'intigo',

              state:
                'created',

              providerStatusCode:
                currentStatus
            },

            {
              $set: {
                'metadata.intigoTrackingCompletedAt':
                  completedAt,

                'metadata.intigoTrackingCompletedStatusCode':
                  currentStatus
              }
            }
          );

          summary.completedTracking +=
            1;
        }
      } catch (error) {
        summary.errors +=
          1;

        errors.push({
          shipmentId:
            String(
              shipment._id
            ),

          message:
            error.message,

          statusCode:
            error.statusCode ||
            null
        });
      }
    }

    return {
      success:
        summary.errors === 0,

      provider:
        'intigo',

      remoteMutationPerformed:
        false,

      summary,

      errors
    };
  };

module.exports = {
  TERMINAL_CODES,
  isTerminalIntigoStatus,
  runIntigoStatusSyncBatch
};
