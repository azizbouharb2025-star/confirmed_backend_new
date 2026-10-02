const Notification = require('../models/Notification');
const logger = require('../utils/logger');

const IMPORTANT_ORDER_STATUSES = new Set([
  'confirmed',
  'shipped',
  'delivered',
  'failed_delivery',
  'cancelled',
  'canceled',
  'returned'
]);

const STATUS_LABELS = {
  confirmed: 'confirmée',
  shipped: 'expédiée',
  delivered: 'livrée',
  failed_delivery: 'en échec de livraison',
  cancelled: 'annulée',
  canceled: 'annulée',
  returned: 'retournée'
};

function normalizeOrder(order) {
  if (!order) return {};

  if (typeof order.toObject === 'function') {
    return order.toObject();
  }

  return order;
}

async function createOrderNotification({
  eventType,
  order,
  shopId
}) {
  try {
    if (!shopId) {
      return null;
    }

    const rawOrder = normalizeOrder(order);

    const mongoId =
      rawOrder._id?.toString?.() ||
      rawOrder._id ||
      null;

    const displayId =
      rawOrder.confirmedId ||
      rawOrder.orderId ||
      mongoId ||
      '—';

    const status = rawOrder.status || null;

    let type;
    let title;
    let message;
    let fingerprint;

    if (eventType === 'order:new') {
      type = 'order_new';
      title = 'Nouvelle commande';
      message = `La commande #${displayId} vient d’être reçue.`;
      fingerprint = `order:new:${mongoId || displayId}`;
    } else if (eventType === 'order:update') {
      if (
        !status ||
        !IMPORTANT_ORDER_STATUSES.has(status)
      ) {
        return null;
      }

      const statusLabel =
        STATUS_LABELS[status] ||
        status;

      type = 'order_status';
      title = `Commande #${displayId}`;
      message =
        `La commande #${displayId} est maintenant ${statusLabel}.`;

      fingerprint =
        `order:status:${mongoId || displayId}:${status}`;
    } else if (eventType === 'order:delete') {
      type = 'order_deleted';
      title = 'Commande supprimée';
      message =
        `La commande #${displayId} a été supprimée.`;

      fingerprint =
        `order:delete:${mongoId || displayId}`;
    } else {
      return null;
    }

    return await Notification.create({
      shopId,
      type,
      title,
      message,
      orderId: String(displayId),
      orderStatus: status,
      fingerprint,
      metadata: {
        orderMongoId: mongoId
      }
    });
  } catch (error) {
    if (error?.code === 11000) {
      return null;
    }

    logger.error(
      'Failed to create in-app notification:',
      error
    );

    return null;
  }
}

module.exports = {
  createOrderNotification
};
