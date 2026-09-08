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

    if (
      existingShipment &&
      ['preparing', 'created'].includes(
        existingShipment.state
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

module.exports = {
  analyzeIntigoOrders,
  toPublicAnalysis,
  buildDryRunResult
};
