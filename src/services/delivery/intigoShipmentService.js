const mongoose = require('mongoose');

const Order = require('../../models/Order');
const DeliveryIntegration = require('../../models/DeliveryIntegration');
const DeliveryShipment = require('../../models/DeliveryShipment');

const intigoClient = require('./intigoClient');

const {
  mapOrderToIntigo
} = require('./intigoMapper');

const MAX_ORDERS = 100;

const createValidationError = (
  message,
  extra = {}
) => {
  const error = new Error(message);

  error.statusCode = 400;

  Object.assign(
    error,
    extra
  );

  return error;
};

const normalizeOrderIds = orderIds => {
  if (
    !Array.isArray(orderIds) ||
    orderIds.length === 0
  ) {
    throw createValidationError(
      'orderIds must contain at least one order'
    );
  }

  if (orderIds.length > MAX_ORDERS) {
    throw createValidationError(
      `Maximum ${MAX_ORDERS} orders per Intigo request`
    );
  }

  const normalizedIds = [
    ...new Set(
      orderIds.map(id =>
        String(id).trim()
      )
    )
  ];

  const malformedIds =
    normalizedIds.filter(
      id =>
        !mongoose.Types.ObjectId.isValid(id)
    );

  if (malformedIds.length > 0) {
    throw createValidationError(
      'Invalid MongoDB order IDs',
      {
        invalidOrderIds: malformedIds
      }
    );
  }

  return normalizedIds;
};

const sanitizeIntigoPayload = (
  payload,
  location,
  pickupIndex
) => {
  const result = {
    ...payload,

    /*
     * Toujours utiliser le nom canonique retourné
     * par le référentiel Intigo.
     */
    city_name: location.city.name,

    pickup_index: pickupIndex
  };

  /*
   * Si la délégation a été résolue, on envoie
   * le nom canonique Intigo.
   *
   * Sinon on retire district_name pour laisser
   * le mécanisme de fallback Intigo travailler.
   */
  if (location.district?.name) {
    result.district_name =
      location.district.name;
  } else {
    delete result.district_name;
  }

  /*
   * Éviter les champs optionnels vides.
   */
  for (const key of [
    'phone2',
    'client_email',
    'additional_info'
  ]) {
    if (!result[key]) {
      delete result[key];
    }
  }

  return result;
};

const publicItem = item => {
  const {
    payload,
    ...safe
  } = item;

  return safe;
};

const publicList = list =>
  list.map(publicItem);

const analyzeIntigoOrders = async ({
  shopId,
  orderIds
}) => {
  const normalizedIds =
    normalizeOrderIds(orderIds);

  /*
   * L'intégration est lue ici côté serveur.
   * La clé API n'est jamais exposée dans
   * le résultat public.
   */
  const integration =
    await DeliveryIntegration.findOne({
      shopId,
      platform: 'intigo',
      isActive: true
    })
      .lean();

  const pickupIndex =
    integration?.settings?.pickupIndex;

  const integrationReady = Boolean(
    integration &&
    integration.credentials?.apiKey &&
    Number.isInteger(pickupIndex)
  );

  const orders = await Order.find({
    _id: {
      $in: normalizedIds
    },
    shopId
  })
    .lean();

  const orderById = new Map(
    orders.map(order => [
      String(order._id),
      order
    ])
  );

  const existingShipments =
    await DeliveryShipment.find({
      orderId: {
        $in: normalizedIds
      },
      provider: 'intigo'
    })
      .select({
        orderId: 1,
        correlationId: 1,
        externalId: 1,
        state: 1,
        reservationExpiresAt: 1,
        updatedAt: 1
      })
      .lean();

  const shipmentByOrderId = new Map(
    existingShipments.map(shipment => [
      String(shipment.orderId),
      shipment
    ])
  );

  const ready = [];
  const review = [];
  const duplicate = [];
  const invalid = [];

  for (
    const requestedId of normalizedIds
  ) {
    const order =
      orderById.get(requestedId);

    if (!order) {
      invalid.push({
        orderId: requestedId,
        confirmedId: null,
        errors: [
          'Commande introuvable ou hors de cette boutique'
        ]
      });

      continue;
    }

    const existingShipment =
      shipmentByOrderId.get(requestedId);

    const activePreparing =
      existingShipment &&
      existingShipment.state === 'preparing' &&
      (
        !existingShipment.reservationExpiresAt ||
        new Date(
          existingShipment.reservationExpiresAt
        ).getTime() > Date.now()
      );

    if (
      existingShipment &&
      (
        existingShipment.state === 'created' ||
        activePreparing
      )
    ) {
      duplicate.push({
        orderId: requestedId,
        confirmedId:
          order.confirmedId,
        state:
          existingShipment.state,
        correlationId:
          existingShipment.correlationId ||
          null,
        externalId:
          existingShipment.externalId ||
          null
      });

      continue;
    }

    const {
      payload,
      errors
    } = mapOrderToIntigo(order);

    if (errors.length > 0) {
      invalid.push({
        orderId: requestedId,
        confirmedId:
          order.confirmedId,
        errors
      });

      continue;
    }

    const location =
      await intigoClient.resolveLocation(
        payload.city_name,
        payload.district_name
      );

    if (!location.valid) {
      invalid.push({
        orderId: requestedId,
        confirmedId:
          order.confirmedId,
        errors: [
          location.error
        ]
      });

      continue;
    }

    const finalPayload =
      sanitizeIntigoPayload(
        payload,
        location,
        pickupIndex
      );

    const item = {
      orderId: requestedId,

      confirmedId:
        order.confirmedId,

      cid:
        payload.cid,

      city_name:
        location.city.name,

      district_name:
        location.district?.name ||
        null,

      districtResolved:
        Boolean(
          location.district
        ),

      districtFallback:
        Boolean(
          location.warning
        ),

      pickupIndex:
        Number.isInteger(
          pickupIndex
        )
          ? pickupIndex
          : null,

      price:
        payload.price,

      itemCount:
        Array.isArray(order.items)
          ? order.items.length
          : 0,

      warnings:
        location.warning
          ? [
              location.warning
            ]
          : [],

      /*
       * Payload interne seulement.
       * Ne doit jamais être renvoyé directement
       * par une route publique.
       */
      payload:
        finalPayload
    };

    if (location.warning) {
      review.push(item);
      continue;
    }

    ready.push(item);
  }

  return {
    integration: {
      configured:
        Boolean(integration),

      ready:
        integrationReady,

      pickupIndex:
        Number.isInteger(
          pickupIndex
        )
          ? pickupIndex
          : null
    },

    normalizedIds,

    ready,
    review,
    duplicate,
    invalid
  };
};

const toPublicAnalysis =
  analysis => ({
    integration:
      analysis.integration,

    summary: {
      selected:
        analysis.normalizedIds.length,

      ready:
        analysis.ready.length,

      review:
        analysis.review.length,

      duplicate:
        analysis.duplicate.length,

      invalid:
        analysis.invalid.length
    },

    ready:
      publicList(
        analysis.ready
      ),

    review:
      publicList(
        analysis.review
      ),

    duplicate:
      analysis.duplicate,

    invalid:
      analysis.invalid
  });

const buildDryRunResult = ({
  analysis,
  allowReview = false
}) => {
  /*
   * Une intégration non prête ne doit jamais
   * produire une liste "wouldSend".
   */
  const integrationReady =
    analysis.integration.ready;

  const readyToSend =
    integrationReady
      ? analysis.ready
      : [];

  const reviewedToSend =
    integrationReady &&
    allowReview
      ? analysis.review
      : [];

  const wouldSend = [
    ...readyToSend,
    ...reviewedToSend
  ];

  const blockedReview =
    allowReview
      ? []
      : analysis.review;

  return {
    success: true,

    provider: 'intigo',

    dryRun: true,

    allowReview:
      Boolean(allowReview),

    integration:
      analysis.integration,

    summary: {
      selected:
        analysis.normalizedIds.length,

      ready:
        analysis.ready.length,

      review:
        analysis.review.length,

      duplicate:
        analysis.duplicate.length,

      invalid:
        analysis.invalid.length,

      wouldSend:
        wouldSend.length,

      reviewBlocked:
        blockedReview.length
    },

    wouldSend:
      publicList(
        wouldSend
      ),

    reviewBlocked:
      publicList(
        blockedReview
      ),

    duplicate:
      analysis.duplicate,

    invalid:
      analysis.invalid
  };
};


// ─────────────────────────────────────────────────────────────
// RESERVATION LOCALE ATOMIQUE
// Aucun appel Intigo dans cette section.
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

const RESERVATION_TTL_MS =
  15 * 60 * 1000;

const isActivePreparingShipment = shipment => {
  if (
    !shipment ||
    shipment.state !== 'preparing'
  ) {
    return false;
  }

  /*
   * Ancienne réservation sans expiration :
   * on la considère active par sécurité.
   */
  if (!shipment.reservationExpiresAt) {
    return true;
  }

  return (
    new Date(
      shipment.reservationExpiresAt
    ).getTime() > Date.now()
  );
};

const reserveSingleIntigoShipment = async ({
  shopId,
  userId,
  item,
  reservationId,
  now,
  expiresAt
}) => {
  /*
   * 1. On tente d'abord de reprendre un shipment
   * failed/cancelled ou une réservation expirée.
   *
   * findOneAndUpdate est atomique sur ce document.
   */
  const reusable =
    await DeliveryShipment.findOneAndUpdate(
      {
        orderId: item.orderId,
        provider: 'intigo',

        $or: [
          {
            state: {
              $in: [
                'failed',
                'cancelled'
              ]
            }
          },

          {
            state: 'preparing',
            reservationExpiresAt: {
              $lte: now
            }
          }
        ]
      },

      {
        $set: {
          shopId,

          correlationId:
            item.cid,

          state:
            'preparing',

          metadata: {
            cityName:
              item.city_name,

            districtName:
              item.district_name,

            districtResolved:
              item.districtResolved,

            districtFallback:
              item.districtFallback,

            pickupIndex:
              item.pickupIndex
          },

          createdBy:
            userId,

          reservationId,

          reservedAt:
            now,

          reservationExpiresAt:
            expiresAt
        },

        $unset: {
          externalId: 1,
          providerStatusCode: 1,
          providerStatusLabel: 1,
          lastError: 1
        }
      },

      {
        new: true
      }
    );

  if (reusable) {
    return {
      status: 'reserved',
      shipment: reusable
    };
  }

  /*
   * 2. Sinon création.
   *
   * L'index unique:
   *   { orderId, provider }
   *
   * est la dernière barrière contre deux workers
   * PM2 réservant simultanément la même commande.
   */
  try {
    const shipment =
      await DeliveryShipment.create({
        shopId,

        orderId:
          item.orderId,

        provider:
          'intigo',

        correlationId:
          item.cid,

        state:
          'preparing',

        metadata: {
          cityName:
            item.city_name,

          districtName:
            item.district_name,

          districtResolved:
            item.districtResolved,

          districtFallback:
            item.districtFallback,

          pickupIndex:
            item.pickupIndex
        },

        createdBy:
          userId,

        reservationId,

        reservedAt:
          now,

        reservationExpiresAt:
          expiresAt
      });

    return {
      status: 'reserved',
      shipment
    };
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    /*
     * Un autre worker a gagné la course.
     */
    const existing =
      await DeliveryShipment.findOne({
        orderId:
          item.orderId,

        provider:
          'intigo'
      })
        .lean();

    return {
      status: 'duplicate',
      shipment: existing
    };
  }
};

const reserveIntigoShipments = async ({
  shopId,
  userId,
  analysis,
  allowReview = false
}) => {
  if (!analysis.integration.ready) {
    const error = new Error(
      'Intigo integration is not ready'
    );

    error.statusCode = 409;

    throw error;
  }

  const reservationId =
    crypto.randomUUID();

  const now =
    new Date();

  const expiresAt =
    new Date(
      now.getTime() +
      RESERVATION_TTL_MS
    );

  const candidates = [
    ...analysis.ready,

    ...(allowReview
      ? analysis.review
      : [])
  ];

  const reserved = [];

  const raceDuplicates = [];

  for (const item of candidates) {
    const result =
      await reserveSingleIntigoShipment({
        shopId,
        userId,
        item,
        reservationId,
        now,
        expiresAt
      });

    if (
      result.status ===
      'reserved'
    ) {
      reserved.push({
        shipmentId:
          String(
            result.shipment._id
          ),

        orderId:
          item.orderId,

        confirmedId:
          item.confirmedId,

        correlationId:
          item.cid,

        state:
          result.shipment.state
      });

      continue;
    }

    raceDuplicates.push({
      orderId:
        item.orderId,

      confirmedId:
        item.confirmedId,

      state:
        result.shipment?.state ||
        'unknown',

      correlationId:
        result.shipment?.correlationId ||
        null,

      externalId:
        result.shipment?.externalId ||
        null
    });
  }

  const duplicate = [
    ...analysis.duplicate,
    ...raceDuplicates
  ];

  const reviewBlocked =
    allowReview
      ? []
      : publicList(
          analysis.review
        );

  return {
    success: true,

    provider: 'intigo',

    reservationOnly: true,

    /*
     * Cet identifiant permettra plus tard au POST réel
     * de ne consommer que les réservations de ce batch.
     */
    reservationId,

    reservationExpiresAt:
      expiresAt,

    allowReview:
      Boolean(allowReview),

    integration:
      analysis.integration,

    summary: {
      selected:
        analysis.normalizedIds.length,

      ready:
        analysis.ready.length,

      review:
        analysis.review.length,

      reserved:
        reserved.length,

      reviewBlocked:
        reviewBlocked.length,

      duplicate:
        duplicate.length,

      invalid:
        analysis.invalid.length
    },

    reserved,

    reviewBlocked,

    duplicate,

    invalid:
      analysis.invalid
  };
};


const buildIntigoDispatchPreview = async ({
  shopId,
  reservationId
}) => {
  const normalizedReservationId =
    String(
      reservationId || ''
    ).trim();

  if (!normalizedReservationId) {
    const error = new Error(
      'reservationId is required'
    );

    error.statusCode = 400;

    throw error;
  }

  const shipments =
    await DeliveryShipment.find({
      shopId,
      provider: 'intigo',
      reservationId:
        normalizedReservationId
    })
      .lean();

  if (shipments.length === 0) {
    const error = new Error(
      'Intigo reservation not found'
    );

    error.statusCode = 404;

    throw error;
  }

  const invalidState =
    shipments.filter(
      shipment =>
        shipment.state !==
        'preparing'
    );

  if (invalidState.length > 0) {
    const error = new Error(
      'Reservation contains non-preparing shipments'
    );

    error.statusCode = 409;

    throw error;
  }

  const now =
    Date.now();

  const expired =
    shipments.filter(
      shipment =>
        !shipment.reservationExpiresAt ||
        new Date(
          shipment.reservationExpiresAt
        ).getTime() <= now
    );

  if (expired.length > 0) {
    const error = new Error(
      'Intigo reservation has expired'
    );

    error.statusCode = 409;

    throw error;
  }

  /*
   * L'intégration est relue au dernier moment.
   */
  const integration =
    await DeliveryIntegration.findOne({
      shopId,
      platform: 'intigo',
      isActive: true
    })
      .lean();

  const pickupIndex =
    integration?.settings?.pickupIndex;

  if (
    !integration ||
    !integration.credentials?.apiKey ||
    !Number.isInteger(
      pickupIndex
    )
  ) {
    const error = new Error(
      'Intigo integration is not ready'
    );

    error.statusCode = 409;

    throw error;
  }

  const orderIds =
    shipments.map(
      shipment =>
        shipment.orderId
    );

  const orders =
    await Order.find({
      _id: {
        $in: orderIds
      },
      shopId
    })
      .lean();

  const orderById =
    new Map(
      orders.map(
        order => [
          String(order._id),
          order
        ]
      )
    );

  const wouldPost = [];
  const invalid = [];

  for (
    const shipment of shipments
  ) {
    const order =
      orderById.get(
        String(
          shipment.orderId
        )
      );

    if (!order) {
      invalid.push({
        shipmentId:
          String(
            shipment._id
          ),

        orderId:
          String(
            shipment.orderId
          ),

        errors: [
          'Commande introuvable ou hors de cette boutique'
        ]
      });

      continue;
    }

    const {
      payload,
      errors
    } = mapOrderToIntigo(
      order
    );

    if (errors.length > 0) {
      invalid.push({
        shipmentId:
          String(
            shipment._id
          ),

        orderId:
          String(
            order._id
          ),

        confirmedId:
          order.confirmedId,

        errors
      });

      continue;
    }

    const location =
      await intigoClient.resolveLocation(
        payload.city_name,
        payload.district_name
      );

    if (!location.valid) {
      invalid.push({
        shipmentId:
          String(
            shipment._id
          ),

        orderId:
          String(
            order._id
          ),

        confirmedId:
          order.confirmedId,

        errors: [
          location.error
        ]
      });

      continue;
    }

    /*
     * La configuration pickup ne doit pas
     * avoir changé depuis la réservation.
     */
    const reservedPickup =
      shipment.metadata?.pickupIndex;

    if (
      Number.isInteger(
        reservedPickup
      ) &&
      reservedPickup !==
        pickupIndex
    ) {
      invalid.push({
        shipmentId:
          String(
            shipment._id
          ),

        orderId:
          String(
            order._id
          ),

        confirmedId:
          order.confirmedId,

        errors: [
          'Pickup Intigo modifié depuis la réservation'
        ]
      });

      continue;
    }

    /*
     * Si cette réservation avait été
     * explicitement approuvée avec fallback,
     * districtFallback sera true.
     */
    if (
      location.warning &&
      shipment.metadata
        ?.districtFallback !==
        true
    ) {
      invalid.push({
        shipmentId:
          String(
            shipment._id
          ),

        orderId:
          String(
            order._id
          ),

        confirmedId:
          order.confirmedId,

        errors: [
          'La destination nécessite désormais une validation REVIEW'
        ]
      });

      continue;
    }

    const finalPayload =
      sanitizeIntigoPayload(
        payload,
        location,
        pickupIndex
      );

    if (
      shipment.correlationId &&
      shipment.correlationId !==
        finalPayload.cid
    ) {
      invalid.push({
        shipmentId:
          String(
            shipment._id
          ),

        orderId:
          String(
            order._id
          ),

        confirmedId:
          order.confirmedId,

        errors: [
          'La référence Confirmed a changé depuis la réservation'
        ]
      });

      continue;
    }

    /*
     * Empreinte du payload réel.
     *
     * Le contenu client n'est jamais
     * renvoyé par cette route.
     */
    const payloadHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          JSON.stringify(
            finalPayload
          )
        )
        .digest(
          'hex'
        );

    wouldPost.push({
      shipmentId:
        String(
          shipment._id
        ),

      orderId:
        String(
          order._id
        ),

      confirmedId:
        order.confirmedId,

      correlationId:
        finalPayload.cid,

      currentState:
        'preparing',

      proposedState:
        'created',

      request: {
        method:
          'POST',

        resource:
          '/parcels/by-name'
      },

      city_name:
        finalPayload.city_name,

      district_name:
        finalPayload.district_name ||
        null,

      pickupIndex:
        finalPayload.pickup_index,

      price:
        finalPayload.price,

      payloadHash
    });
  }

  return {
    success: true,

    provider:
      'intigo',

    dispatchPreview:
      true,

    remoteCallPerformed:
      false,

    databaseTransitionPerformed:
      false,

    reservationId:
      '<configured>',

    reservationExpiresAt:
      shipments[0]
        ?.reservationExpiresAt ||
      null,

    integration: {
      ready: true,

      pickupIndex
    },

    summary: {
      reserved:
        shipments.length,

      wouldPost:
        wouldPost.length,

      invalid:
        invalid.length
    },

    wouldPost,

    invalid
  };
};

module.exports = {
  analyzeIntigoOrders,
  toPublicAnalysis,
  buildDryRunResult,
  reserveIntigoShipments,
  isActivePreparingShipment,
  buildIntigoDispatchPreview
};
