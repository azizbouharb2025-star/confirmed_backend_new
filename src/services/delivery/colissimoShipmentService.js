const mongoose = require('mongoose');
const crypto = require('crypto');

const Order =
  require('../../models/Order');

const DeliveryShipment =
  require('../../models/DeliveryShipment');

const DeliveryIntegration =
  require('../../models/DeliveryIntegration');

const {
  mapOrderToColissimo
} = require('./colissimoMapper');

const colissimoClient =
  require('./colissimoClient');

const makeError = (
  message,
  statusCode,
  extra = {}
) => {
  const error =
    new Error(message);

  error.statusCode =
    statusCode;

  Object.assign(
    error,
    extra
  );

  return error;
};

const analyzeColissimoOrders =
  async ({
    shopId,
    orderIds,
    typeColis,
    ouvrir = false,
    fragile = false
  }) => {
    if (
      !Array.isArray(orderIds) ||
      orderIds.length === 0
    ) {
      throw makeError(
        'orderIds must be a non-empty array',
        400
      );
    }

    const ids = [
      ...new Set(
        orderIds.map(id =>
          String(id)
        )
      )
    ];

    const malformed =
      ids.filter(
        id =>
          !mongoose.isValidObjectId(
            id
          )
      );

    if (malformed.length) {
      throw makeError(
        'Invalid orderIds',
        400,
        {
          invalidOrderIds:
            malformed
        }
      );
    }

    const orders =
      await Order.find({
        _id: {
          $in: ids
        },

        shopId
      }).lean();

    const orderMap =
      new Map(
        orders.map(order => [
          String(order._id),
          order
        ])
      );

    const items =
      ids.map(orderId => {
        const order =
          orderMap.get(
            orderId
          );

        if (!order) {
          return {
            orderId,
            confirmedId: null,
            status: 'INVALID',
            errors: [
              'Commande introuvable ou hors boutique'
            ],
            warnings: [],
            payload: null
          };
        }

        const mapped =
          mapOrderToColissimo(
            order,
            {
              typeColis,
              ouvrir,
              fragile
            }
          );

        const status =
          mapped.errors.length
            ? 'INVALID'
            : mapped.warnings.length
              ? 'REVIEW'
              : 'READY';

        return {
          orderId:
            String(order._id),

          confirmedId:
            order.confirmedId,

          correlationId:
            order.confirmedId != null
              ? `CONF-${order.confirmedId}`
              : String(order._id),

          status,

          errors:
            mapped.errors,

          warnings:
            mapped.warnings,

          payload:
            mapped.payload
        };
      });

    return {
      selected:
        items.length,

      ready:
        items.filter(
          item =>
            item.status ===
            'READY'
        ).length,

      review:
        items.filter(
          item =>
            item.status ===
            'REVIEW'
        ).length,

      invalid:
        items.filter(
          item =>
            item.status ===
            'INVALID'
        ).length,

      remoteCallPerformed:
        false,

      items
    };
  };


const RESERVATION_TTL_MS =
  15 * 60 * 1000;

const isActiveColissimoPreparingShipment =
  shipment => {
    if (
      !shipment ||
      shipment.state !== 'preparing'
    ) {
      return false;
    }

    /*
     * Ancienne réservation sans date d'expiration :
     * active par sécurité.
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

const toPublicReservationItem =
  item => ({
    orderId:
      item.orderId,

    confirmedId:
      item.confirmedId,

    correlationId:
      item.correlationId ||
      null,

    status:
      item.status,

    errors:
      item.errors || [],

    warnings:
      item.warnings || []
  });

const reserveSingleColissimoShipment =
  async ({
    shopId,
    userId,
    item,
    reservationId,
    now,
    expiresAt,
    typeColis,
    ouvrir,
    fragile
  }) => {
    const metadata = {
      typeColis:
        Number(typeColis),

      ouvrir:
        Boolean(ouvrir),

      fragile:
        Boolean(fragile),

      governorate:
        item.payload?.gouvernerat ||
        null,

      city:
        item.payload?.ville ||
        null
    };

    /*
     * Réutilisation atomique uniquement si :
     * - ancien échec
     * - annulation
     * - préparation expirée
     *
     * created / dispatching / reconcile_required
     * ne sont jamais réutilisés automatiquement.
     */
    const reusable =
      await DeliveryShipment.findOneAndUpdate(
        {
          orderId:
            item.orderId,

          provider:
            'colissimo',

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
              state:
                'preparing',

              reservationExpiresAt: {
                $lte:
                  now
              }
            }
          ]
        },

        {
          $set: {
            shopId,

            correlationId:
              item.correlationId,

            state:
              'preparing',

            metadata,

            createdBy:
              userId || null,

            reservationId,

            reservedAt:
              now,

            reservationExpiresAt:
              expiresAt
          },

          $unset: {
            externalId:
              1,

            providerStatusCode:
              1,

            providerStatusLabel:
              1,

            lastError:
              1,

            dispatchStartedAt:
              1,

            payloadHash:
              1
          }
        },

        {
          new:
            true
        }
      );

    if (reusable) {
      return {
        status:
          'reserved',

        shipment:
          reusable
      };
    }

    /*
     * Nouvelle réservation.
     *
     * L'index unique { orderId, provider }
     * protège aussi contre deux workers PM2.
     */
    try {
      const shipment =
        await DeliveryShipment.create({
          shopId,

          orderId:
            item.orderId,

          provider:
            'colissimo',

          correlationId:
            item.correlationId,

          state:
            'preparing',

          metadata,

          createdBy:
            userId || undefined,

          reservationId,

          reservedAt:
            now,

          reservationExpiresAt:
            expiresAt
        });

      return {
        status:
          'reserved',

        shipment
      };
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      const existing =
        await DeliveryShipment.findOne({
          orderId:
            item.orderId,

          provider:
            'colissimo'
        })
          .lean();

      return {
        status:
          'duplicate',

        shipment:
          existing
      };
    }
  };

const reserveColissimoShipments =
  async ({
    shopId,
    userId,
    analysis,
    typeColis,
    ouvrir = false,
    fragile = false,
    allowReview = false
  }) => {
    const reservationId =
      crypto.randomUUID();

    const now =
      new Date();

    const expiresAt =
      new Date(
        now.getTime() +
        RESERVATION_TTL_MS
      );

    const ready =
      analysis.items.filter(
        item =>
          item.status ===
          'READY'
      );

    const review =
      analysis.items.filter(
        item =>
          item.status ===
          'REVIEW'
      );

    const invalid =
      analysis.items.filter(
        item =>
          item.status ===
          'INVALID'
      );

    const candidates = [
      ...ready,

      ...(allowReview
        ? review
        : [])
    ];

    const reserved = [];
    const raceDuplicates = [];

    for (const item of candidates) {
      const result =
        await reserveSingleColissimoShipment({
          shopId,
          userId,
          item,
          reservationId,
          now,
          expiresAt,
          typeColis,
          ouvrir,
          fragile
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
            item.correlationId,

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

        correlationId:
          result.shipment?.correlationId ||
          item.correlationId ||
          null,

        state:
          result.shipment?.state ||
          'unknown',

        externalId:
          result.shipment?.externalId ||
          null
      });
    }

    const reviewBlocked =
      allowReview
        ? []
        : review.map(
            toPublicReservationItem
          );

    return {
      success:
        true,

      provider:
        'colissimo',

      reservationOnly:
        true,

      remoteCallPerformed:
        false,

      reservationId,

      reservationExpiresAt:
        expiresAt,

      allowReview:
        Boolean(allowReview),

      summary: {
        selected:
          analysis.selected,

        ready:
          ready.length,

        review:
          review.length,

        reserved:
          reserved.length,

        reviewBlocked:
          reviewBlocked.length,

        duplicate:
          raceDuplicates.length,

        invalid:
          invalid.length
      },

      reserved,

      reviewBlocked,

      duplicate:
        raceDuplicates,

      invalid:
        invalid.map(
          toPublicReservationItem
        )
    };
  };


const buildColissimoDispatchPreview =
  async ({
    shopId,
    reservationId
  }) => {
    const normalizedReservationId =
      String(
        reservationId || ''
      ).trim();

    if (!normalizedReservationId) {
      throw makeError(
        'reservationId is required',
        400
      );
    }

    const shipments =
      await DeliveryShipment.find({
        shopId,
        provider:
          'colissimo',

        reservationId:
          normalizedReservationId
      })
        .lean();

    if (
      shipments.length === 0
    ) {
      throw makeError(
        'Colissimo reservation not found',
        404
      );
    }

    const invalidState =
      shipments.filter(
        shipment =>
          shipment.state !==
          'preparing'
      );

    if (
      invalidState.length > 0
    ) {
      throw makeError(
        'Reservation contains non-preparing shipments',
        409
      );
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

    if (
      expired.length > 0
    ) {
      throw makeError(
        'Colissimo reservation has expired',
        409
      );
    }

    /*
     * Lecture de l'intégration uniquement.
     * Aucun appel Colissimo.
     */
    const integration =
      await DeliveryIntegration.findOne({
        shopId,
        platform:
          'colissimo',
        isActive:
          true
      })
        .lean();

    const addTokenConfigured =
      Boolean(
        String(
          integration
            ?.credentials
            ?.addToken ||
          ''
        ).trim()
      );

    const integrationState = {
      configured:
        Boolean(integration),

      active:
        Boolean(
          integration?.isActive
        ),

      addTokenConfigured,

      trackingTokenConfigured:
        Boolean(
          String(
            integration
              ?.credentials
              ?.trackingToken ||
            ''
          ).trim()
        ),

      readyForLiveCreate:
        Boolean(
          integration &&
          integration.isActive &&
          addTokenConfigured
        )
    };

    const orderIds =
      shipments.map(
        shipment =>
          shipment.orderId
      );

    const orders =
      await Order.find({
        _id: {
          $in:
            orderIds
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
            'Commande introuvable ou hors boutique'
          ]
        });

        continue;
      }

      const metadata =
        shipment.metadata ||
        {};

      const mapped =
        mapOrderToColissimo(
          order,
          {
            typeColis:
              metadata.typeColis,

            ouvrir:
              Boolean(
                metadata.ouvrir
              ),

            fragile:
              Boolean(
                metadata.fragile
              )
          }
        );

      if (
        mapped.errors.length >
        0
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

          errors:
            mapped.errors,

          warnings:
            mapped.warnings
        });

        continue;
      }

      /*
       * Important :
       * le token n'est PAS inclus dans le hash.
       * On hash uniquement le payload métier
       * envoyé au client Colissimo.
       */
      const payloadHash =
        crypto
          .createHash(
            'sha256'
          )
          .update(
            JSON.stringify(
              mapped.payload
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
          shipment.correlationId ||
          null,

        payloadHash,

        warnings:
          mapped.warnings,

        /*
         * Résumé non sensible uniquement.
         */
        destination: {
          governorate:
            mapped.payload
              .gouvernerat,

          city:
            mapped.payload
              .ville
        },

        parcel: {
          articleCount:
            mapped.payload
              .nb_article,

          typeColis:
            mapped.payload
              .type_colis,

          ouvrir:
            mapped.payload
              .ouvrir,

          fragile:
            mapped.payload
              .fragile,

          exchange:
            mapped.payload
              .echange
        },

        amount:
          mapped.payload.prix
      });
    }

    return {
      success:
        true,

      provider:
        'colissimo',

      reservationId:
        normalizedReservationId,

      reservationExpiresAt:
        shipments[0]
          ?.reservationExpiresAt ||
        null,

      integration:
        integrationState,

      endpoint:
        'https://colissimodelivery.tn/api/v1/post.php',

      method:
        'POST',

      summary: {
        reserved:
          shipments.length,

        wouldPost:
          wouldPost.length,

        invalid:
          invalid.length
      },

      wouldPost,
      invalid,

      remoteCallPerformed:
        false,

      databaseMutationPerformed:
        false
    };
  };


const dispatchColissimoReservation =
  async ({
    shopId,
    reservationId,
    expectedCorrelationId,
    expectedPayloadHash,
    confirm
  }) => {
    /*
     * VERROU PRINCIPAL.
     * Aucun appel distant si false.
     */
    if (
      process.env.COLISSIMO_LIVE_DISPATCH_ENABLED !==
      'true'
    ) {
      const error =
        new Error(
          'Live Colissimo dispatch is disabled'
        );

      error.statusCode = 409;
      error.liveDispatchDisabled = true;

      throw error;
    }

    if (confirm !== true) {
      throw makeError(
        'Explicit confirmation is required',
        400
      );
    }

    const cleanReservationId =
      String(
        reservationId || ''
      ).trim();

    const cleanExpectedCid =
      String(
        expectedCorrelationId || ''
      ).trim();

    const cleanExpectedHash =
      String(
        expectedPayloadHash || ''
      ).trim();

    if (!cleanReservationId) {
      throw makeError(
        'reservationId is required',
        400
      );
    }

    if (!cleanExpectedCid) {
      throw makeError(
        'expectedCorrelationId is required',
        400
      );
    }

    if (
      !/^[a-f0-9]{64}$/i.test(
        cleanExpectedHash
      )
    ) {
      throw makeError(
        'expectedPayloadHash must be a SHA-256 hash',
        400
      );
    }

    /*
     * Première version LIVE :
     * exactement UN colis.
     */
    const shipments =
      await DeliveryShipment.find({
        shopId,
        provider:
          'colissimo',
        reservationId:
          cleanReservationId
      })
        .lean();

    if (
      shipments.length !== 1
    ) {
      throw makeError(
        'Live Colissimo dispatch requires exactly one reserved shipment',
        409
      );
    }

    const shipment =
      shipments[0];

    if (
      shipment.state !==
      'preparing'
    ) {
      throw makeError(
        `Shipment is not preparing (${shipment.state})`,
        409
      );
    }

    if (
      !shipment.reservationExpiresAt ||
      new Date(
        shipment.reservationExpiresAt
      ).getTime() <= Date.now()
    ) {
      throw makeError(
        'Colissimo reservation has expired',
        409
      );
    }

    if (
      shipment.correlationId !==
      cleanExpectedCid
    ) {
      throw makeError(
        'Correlation ID confirmation mismatch',
        409
      );
    }

    const order =
      await Order.findOne({
        _id:
          shipment.orderId,
        shopId
      })
        .lean();

    if (!order) {
      throw makeError(
        'Order not found for shipment',
        404
      );
    }

    const integration =
      await DeliveryIntegration.findOne({
        shopId,
        platform:
          'colissimo',
        isActive:
          true
      })
        .lean();

    const addToken =
      String(
        integration
          ?.credentials
          ?.addToken ||
        ''
      ).trim();

    const configuredBaseUrl =
      String(
        integration
          ?.credentials
          ?.baseUrl ||
        ''
      ).trim();

    /*
     * Colissimo creation MUST target post.php.
     * Never POST shipment data to the website root.
     */
    const baseUrl =
      configuredBaseUrl.includes(
        '/api/v1/post.php'
      )
        ? configuredBaseUrl
        : 'https://colissimodelivery.tn/api/v1/post.php';

    if (!addToken) {
      throw makeError(
        'Colissimo integration is not ready',
        409
      );
    }

    const metadata =
      shipment.metadata ||
      {};

    const mapped =
      mapOrderToColissimo(
        order,
        {
          typeColis:
            metadata.typeColis,

          ouvrir:
            Boolean(
              metadata.ouvrir
            ),

          fragile:
            Boolean(
              metadata.fragile
            )
        }
      );

    if (
      mapped.errors.length >
      0
    ) {
      throw makeError(
        mapped.errors.join(
          ' | '
        ),
        400
      );
    }

    const actualPayloadHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          JSON.stringify(
            mapped.payload
          )
        )
        .digest(
          'hex'
        );

    if (
      actualPayloadHash !==
      cleanExpectedHash
    ) {
      const error =
        makeError(
          'Payload changed after dispatch preview',
          409
        );

      error.actualPayloadHash =
        actualPayloadHash;

      throw error;
    }

    /*
     * Allowlist optionnelle.
     *
     * - variable vide/absente :
     *   toutes les commandes préparées correctement
     *   peuvent être envoyées.
     *
     * - variable renseignée :
     *   seules les références listées sont autorisées.
     */
    const allowedLiveCids =
      String(
        process.env
          .COLISSIMO_LIVE_ALLOWED_CIDS ||
        ''
      )
        .split(',')
        .map(value =>
          value.trim()
        )
        .filter(Boolean);

    if (
      allowedLiveCids.length > 0 &&
      !allowedLiveCids.includes(
        cleanExpectedCid
      )
    ) {
      const error =
        new Error(
          'Live Colissimo dispatch is not allowed for this order'
        );

      error.statusCode = 403;
      error.liveDispatchNotAllowed =
        true;

      throw error;
    }

    /*
     * VERROU DURABLE AVANT LE POST.
     */
    const dispatchStartedAt =
      new Date();

    const dispatchingShipment =
      await DeliveryShipment.findOneAndUpdate(
        {
          _id:
            shipment._id,

          shopId,

          provider:
            'colissimo',

          state:
            'preparing',

          reservationId:
            cleanReservationId,

          reservationExpiresAt: {
            $gt:
              dispatchStartedAt
          }
        },

        {
          $set: {
            state:
              'dispatching',

            dispatchStartedAt,

            payloadHash:
              actualPayloadHash
          }
        },

        {
          new:
            true
        }
      );

    if (!dispatchingShipment) {
      throw makeError(
        'Shipment dispatch lock could not be acquired',
        409
      );
    }

    /*
     * À PARTIR D'ICI :
     * un POST Colissimo peut réellement avoir commencé.
     */
    let remoteResult;

    try {
      remoteResult =
        await colissimoClient
          .createShipment({
            token:
              addToken,

            baseUrl,

            payload:
              mapped.payload
          });
    } catch (error) {
      const remoteStatus =
        error.response
          ?.status;

      /*
       * 4xx = rejet certain.
       *
       * Timeout / réseau / 5xx :
       * impossible de savoir avec certitude si
       * Colissimo a créé le colis.
       */
      const definitiveFailure =
        Number.isInteger(
          remoteStatus
        ) &&
        remoteStatus >= 400 &&
        remoteStatus < 500;

      const nextState =
        definitiveFailure
          ? 'failed'
          : 'reconcile_required';

      await DeliveryShipment.updateOne(
        {
          _id:
            shipment._id,

          state:
            'dispatching',

          reservationId:
            cleanReservationId
        },

        {
          $set: {
            state:
              nextState,

            lastError: {
              message:
                error.response
                  ?.data
                  ?.message ||
                error.message,

              code:
                remoteStatus ||
                null,

              at:
                new Date()
            }
          },

          $unset: {
            reservationId:
              1,

            reservedAt:
              1,

            reservationExpiresAt:
              1
          }
        }
      );

      const dispatchError =
        new Error(
          definitiveFailure
            ? 'Colissimo rejected shipment creation'
            : 'Colissimo result is uncertain; reconciliation required'
        );

      dispatchError.statusCode =
        definitiveFailure
          ? remoteStatus
          : 502;

      dispatchError.shipmentState =
        nextState;

      throw dispatchError;
    }

    const responseData =
      remoteResult
        ?.data || {};

    const success =
      responseData.status === 1 ||
      responseData.status === '1';

    const externalId =
      String(
        responseData
          .status_message ||
        ''
      ).trim();

    /*
     * Une réponse reçue avec status != 1
     * est un rejet applicatif certain.
     */
    if (!success) {
      await DeliveryShipment.updateOne(
        {
          _id:
            shipment._id,

          state:
            'dispatching',

          reservationId:
            cleanReservationId
        },

        {
          $set: {
            state:
              'failed',

            lastError: {
              message:
                String(
                  responseData?.status_message ||
                  responseData?.message ||
                  responseData?.error ||
                  responseData?.msg ||
                  (
                    Array.isArray(responseData?.errors)
                      ? responseData.errors.join(' | ')
                      : responseData?.errors
                  ) ||
                  JSON.stringify(responseData) ||
                  'Colissimo creation rejected'
                ).slice(0, 2000),

              code:
                responseData.status ??
                remoteResult?.status ??
                null,

              at:
                new Date()
            }
          },

          $unset: {
            reservationId:
              1,

            reservedAt:
              1,

            reservationExpiresAt:
              1
          }
        }
      );

      const providerMessage =
        String(
          responseData?.status_message ||
          responseData?.message ||
          responseData?.error ||
          responseData?.msg ||
          (
            Array.isArray(responseData?.errors)
              ? responseData.errors.join(' | ')
              : responseData?.errors
          ) ||
          JSON.stringify(responseData) ||
          'Colissimo creation rejected'
        ).slice(0, 2000);

      const error =
        new Error(
          `Colissimo: ${providerMessage}`
        );

      error.statusCode = 400;
      error.shipmentState =
        'failed';

      throw error;
    }

    /*
     * status=1 mais sans code-barres :
     * réponse incohérente.
     * On ne retry surtout pas automatiquement.
     */
    if (!externalId) {
      await DeliveryShipment.updateOne(
        {
          _id:
            shipment._id,

          state:
            'dispatching',

          reservationId:
            cleanReservationId
        },

        {
          $set: {
            state:
              'reconcile_required',

            lastError: {
              message:
                'Colissimo returned success without tracking code',

              code:
                remoteResult?.status ||
                null,

              at:
                new Date()
            }
          },

          $unset: {
            reservationId:
              1,

            reservedAt:
              1,

            reservationExpiresAt:
              1
          }
        }
      );

      const error =
        new Error(
          'Unexpected Colissimo response; reconciliation required'
        );

      error.statusCode = 502;
      error.shipmentState =
        'reconcile_required';

      throw error;
    }

    const standardLabelUrl =
      String(
        responseData.lien ||
        ''
      ).trim();

    const zebraLabelUrl =
      String(
        responseData
          .lien_zebra ||
        ''
      ).trim();

    /*
     * Succès transporteur confirmé.
     */
    const createdShipment =
      await DeliveryShipment.findOneAndUpdate(
        {
          _id:
            shipment._id,

          shopId,

          provider:
            'colissimo',

          state:
            'dispatching',

          reservationId:
            cleanReservationId,

          payloadHash:
            actualPayloadHash
        },

        {
          $set: {
            state:
              'created',

            externalId,

            providerStatusCode:
              responseData.status,

            providerStatusLabel:
              'created',

            metadata: {
              ...metadata,

              labelUrl:
                standardLabelUrl ||
                null,

              zebraLabelUrl:
                zebraLabelUrl ||
                null
            }
          },

          $unset: {
            reservationId:
              1,

            reservedAt:
              1,

            reservationExpiresAt:
              1,

            lastError:
              1
          }
        },

        {
          new:
            true
        }
      );

    if (!createdShipment) {
      /*
       * Le colis existe déjà chez Colissimo,
       * mais notre finalisation locale a échoué.
       * Ne jamais retry automatiquement.
       */
      await DeliveryShipment.updateOne(
        {
          _id:
            shipment._id
        },

        {
          $set: {
            state:
              'reconcile_required',

            externalId,

            lastError: {
              message:
                'Remote Colissimo shipment created but local finalization failed',

              code:
                null,

              at:
                new Date()
            }
          },

          $unset: {
            reservationId:
              1,

            reservedAt:
              1,

            reservationExpiresAt:
              1
          }
        }
      );

      const error =
        new Error(
          'Colissimo shipment was created but local reconciliation is required'
        );

      error.statusCode = 500;
      error.remoteCreated = true;
      error.externalId =
        externalId;
      error.shipmentState =
        'reconcile_required';

      throw error;
    }

    /*
     * Synchronisation pratique de la commande.
     * Le shipment reste la source de vérité transporteur.
     */
    let orderSyncWarning =
      null;

    try {
      await Order.updateOne(
        {
          _id:
            order._id,
          shopId
        },

        {
          $set: {
            'deliveryInfo.trackingNumber':
              externalId,

            'deliveryInfo.carrier':
              'Colissimo'
          }
        }
      );
    } catch (error) {
      orderSyncWarning =
        'Shipment created, but order deliveryInfo could not be synchronized';
    }

    return {
      success:
        true,

      provider:
        'colissimo',

      remoteCallPerformed:
        true,

      shipmentId:
        String(
          createdShipment._id
        ),

      orderId:
        String(order._id),

      confirmedId:
        order.confirmedId,

      correlationId:
        cleanExpectedCid,

      state:
        createdShipment.state,

      externalId,

      trackingNumber:
        externalId,

      labelUrl:
        standardLabelUrl ||
        null,

      zebraLabelUrl:
        zebraLabelUrl ||
        null,

      payloadHash:
        actualPayloadHash,

      orderSyncWarning
    };
  };

module.exports = {
  analyzeColissimoOrders,
  reserveColissimoShipments,
  isActiveColissimoPreparingShipment,
  buildColissimoDispatchPreview,
  dispatchColissimoReservation
};
