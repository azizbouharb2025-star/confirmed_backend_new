require('dotenv').config();

const mongoose =
  require('mongoose');

const DeliveryShipment =
  require('../models/DeliveryShipment');

const Order =
  require('../models/Order');

const {
  syncColissimoShipmentStatus
} =
  require('../services/delivery/colissimoStatusService');

const INTERVAL_MS =
  Number(
    process.env.COLISSIMO_TRACKING_INTERVAL_MS ||
    15 * 60 * 1000
  );

let running = false;

const terminalStatuses =
  new Set([
    'Livre',
    'Livre paye',
    'Retour definitif',
    'Retour recu paye'
  ]);

const runSync = async () => {
  if (running) {
    console.log(
      '[Colissimo tracking] précédent cycle encore actif, skip.'
    );
    return;
  }

  running = true;

  try {
    const shipments =
      await DeliveryShipment.find({
        provider: 'colissimo',
        state: 'created',
        externalId: {
          $exists: true,
          $ne: ''
        }
      })
        .select({
          orderId: 1,
          shopId: 1,
          externalId: 1,
          providerStatusLabel: 1
        })
        .lean();

    const orderIds =
      shipments.map(
        shipment =>
          shipment.orderId
      );

    const existingOrders =
      orderIds.length
        ? await Order.find({
            _id: {
              $in: orderIds
            }
          })
            .select({
              _id: 1
            })
            .lean()
        : [];

    const existingOrderIds =
      new Set(
        existingOrders.map(
          order =>
            String(order._id)
        )
      );

    const orphanCount =
      shipments.filter(
        shipment =>
          !existingOrderIds.has(
            String(
              shipment.orderId
            )
          )
      ).length;

    if (orphanCount > 0) {
      console.log(
        `[Colissimo tracking] ${orphanCount} ancien(s) colis ignoré(s) : commande absente`
      );
    }

    const activeShipments =
      shipments.filter(
        shipment =>
          existingOrderIds.has(
            String(
              shipment.orderId
            )
          ) &&
          !terminalStatuses.has(
            String(
              shipment.providerStatusLabel ||
              ''
            ).trim()
          )
      );

    console.log(
      `[Colissimo tracking] ${activeShipments.length} colis à vérifier`
    );

    for (const shipment of activeShipments) {
      try {
        const result =
          await syncColissimoShipmentStatus({
            shopId:
              shipment.shopId,

            orderId:
              shipment.orderId
          });

        console.log(
          `[Colissimo tracking] ${shipment.externalId} -> ${result.status}`
        );
      } catch (error) {
        try {
          await DeliveryShipment.updateOne(
            {
              _id: shipment._id
            },
            {
              $set: {
                lastError: {
                  message:
                    error.message ||
                    'Erreur tracking Colissimo',

                  code:
                    error.statusCode ||
                    error.response?.status ||
                    error.code ||
                    null,

                  at:
                    new Date()
                }
              }
            }
          );
        } catch (persistError) {
          console.error(
            `[Colissimo tracking] impossible d'enregistrer l'erreur ${shipment.externalId}:`,
            persistError.message
          );
        }

        console.error(
          `[Colissimo tracking] ${shipment.externalId}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      '[Colissimo tracking] cycle failed:',
      error
    );
  } finally {
    running = false;
  }
};

const start = async () => {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI;

  if (!uri) {
    throw new Error(
      'Mongo URI introuvable'
    );
  }

  await mongoose.connect(uri);

  console.log(
    `[Colissimo tracking] worker démarré - intervalle ${INTERVAL_MS / 60000} min`
  );

  await runSync();

  setInterval(
    runSync,
    INTERVAL_MS
  );
};

const shutdown = async signal => {
  console.log(
    `[Colissimo tracking] ${signal} reçu`
  );

  await mongoose.disconnect();

  process.exit(0);
};

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

start().catch(error => {
  console.error(
    '[Colissimo tracking] fatal:',
    error
  );

  process.exit(1);
});
