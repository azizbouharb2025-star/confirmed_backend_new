const Order = require('../models/Order');
const { resolveTunisiaGovernorate } = require('../utils/tunisiaGovernorateResolver');
const aiScoringConfigService = require('./aiScoringConfigService');

class AIScoringService {
  /**
   * Ajustement comportemental V1.
   *
   * Il s'agit d'une règle métier transparente, pas d'un
   * modèle ML entraîné.
   *
   * L'ajustement total est volontairement plafonné à
   * +/- 15 points afin que le retour opérateur améliore
   * le score sans remplacer les autres facteurs.
   */
  calculateOperatorFeedbackAdjustment(feedback) {
    if (!feedback || !feedback.submittedAt) {
      return {
        adjustment: 0,
        applied: false,
        summary: 'Aucun retour opérateur'
      };
    }

    /*
     * PDF Scoring IA :
     * maximum 3 observations de ton/comportement.
     *
     * La validation HTTP applique déjà cette limite.
     * On la réapplique ici par sécurité.
     */
    const toneWeights = {
      polite: 1,
      confident: 1,
      enthusiastic: 1,
      quick_response: 1,

      hesitant: -1,
      distracted: -1,
      long_pauses: -1,

      rude: -2,
      aggressive: -2,
      nervous: -1,
      low_interest: -2
    };

    const confirmationWeights = {
      very_firm: 5,
      normal: 2,
      weak: -4
    };

    const priceWeights = {
      no_issue: 1,
      asks_discount: -1,
      insists_discount: -3,
      strong_negotiation: -4
    };

    const productWeights = {
      none: 1,
      asks_question: 0,
      multiple_doubts: -2,
      compares_seller: -3
    };

    const deliveryWeights = {
      complete_quick: 4,
      clear_precise: 3,
      partial: -1,
      vague: -3,
      difficulty: -4,
      refuses_details: -5
    };

    const engagementWeights = {
      very_engaged: 3,
      interested: 2,
      passive: 0,
      low_involvement: -2,
      distracted: -3
    };

    const receptionWeights = {
      no_information: 0,
      wants_fast_delivery: 3,
      clearly_confirms_receipt: 3,
      asks_delivery_info: 1,
      uncertain_receipt: -2,
      does_not_know_when: -3
    };

    const toneSignals = [
      ...new Set(
        Array.isArray(feedback.toneSignals)
          ? feedback.toneSignals
          : []
      )
    ].slice(0, 3);

    let raw = 0;

    for (const signal of toneSignals) {
      raw += toneWeights[signal] || 0;
    }

    raw +=
      confirmationWeights[
        feedback.confirmationLevel
      ] || 0;

    raw +=
      priceWeights[
        feedback.priceBehavior
      ] || 0;

    raw +=
      productWeights[
        feedback.productDoubts
      ] || 0;

    raw +=
      deliveryWeights[
        feedback.deliveryInformation
      ] || 0;

    raw +=
      engagementWeights[
        feedback.engagementLevel
      ] || 0;

    raw +=
      receptionWeights[
        feedback.receptionIntent
      ] || 0;

    /*
     * IMPORTANT :
     * aucun clamp -15/+15 dans le PDF.
     *
     * Le clamp global du score final sera appliqué
     * entre 20 et 97.
     */
    return {
      adjustment: raw,
      applied: raw !== 0,
      summary:
        raw > 0
          ? 'Retour opérateur globalement favorable'
          : raw < 0
            ? 'Retour opérateur présentant des signaux de vigilance'
            : 'Retour opérateur globalement neutre'
    };
  }

  /**
   * Charge uniquement les données historiques nécessaires
   * au Score IA.
   *
   * L'historique est limité à la boutique actuelle afin
   * de ne pas mélanger les clients de plusieurs shops.
   */
  async buildScoringContext(order) {
    const context = {
      customerHistory: {
        successfulDeliveries: 0,
        failedDeliveries: 0
      },

      orderValueHistory: {
        orderCount: 0,
        averageOrderValue: null
      },

      regionHistory: {
        region: '',
        completedDeliveries: 0,
        deliveredOrders: 0,
        failedDeliveries: 0,
        deliverySuccessRate: null
      },

      orderTimeHistory: {
        hour: null,
        sameHourCompleted: 0,
        sameHourFailed: 0,
        sameHourFailureRate: null,
        overallCompleted: 0,
        overallFailed: 0,
        overallFailureRate: null
      }
    };

    const phone =
      typeof order.clientInfo?.phone === 'string'
        ? order.clientInfo.phone.trim()
        : '';

    const shopId =
      order.shopId?._id ||
      order.shopId;

    if (!shopId) {
      return context;
    }

    /*
     * La commande courante ne doit jamais compter
     * dans son propre historique.
     */
    const baseShopQuery = {
      shopId
    };

    if (order._id) {
      baseShopQuery._id = {
        $ne: order._id
      };
    }

    // ======================================================
    // HISTORIQUE CLIENT + HABITUDES DE MONTANT
    // ======================================================

    if (phone) {
      const customerQuery = {
        ...baseShopQuery,
        'clientInfo.phone': phone
      };

      const [
        successfulDeliveries,
        failedDeliveries,
        valueStats
      ] = await Promise.all([
        Order.countDocuments({
          ...customerQuery,
          status: 'delivered'
        }),

        Order.countDocuments({
          ...customerQuery,
          status: 'failed_delivery'
        }),

        Order.aggregate([
          {
            $match: customerQuery
          },
          {
            $group: {
              _id: null,
              orderCount: {
                $sum: 1
              },
              averageOrderValue: {
                $avg: '$totalAmount'
              }
            }
          }
        ])
      ]);

      context.customerHistory = {
        successfulDeliveries,
        failedDeliveries
      };

      const valueHistory =
        valueStats[0] || null;

      context.orderValueHistory = {
        orderCount:
          valueHistory?.orderCount || 0,

        averageOrderValue:
          valueHistory?.averageOrderValue != null
            ? Number(
                valueHistory.averageOrderValue.toFixed(2)
              )
            : null
      };
    }

    // ======================================================
    // HISTORIQUE DE ZONE
    // ======================================================

    const regionName = String(
      resolveTunisiaGovernorate(order) ||
      order.region ||
      order.clientInfo?.address?.state ||
      order.clientInfo?.address?.city ||
      ''
    ).trim();

    if (regionName) {
      const escapedRegion =
        regionName.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&'
        );

      const regionRegex =
        new RegExp(
          `^${escapedRegion}$`,
          'i'
        );

      const regionQuery = {
        ...baseShopQuery,

        $or: [
          {
            region: regionRegex
          },
          {
            'clientInfo.address.state':
              regionRegex
          },
          {
            'clientInfo.address.city':
              regionRegex
          }
        ]
      };

      const [
        deliveredOrders,
        failedDeliveries
      ] = await Promise.all([
        Order.countDocuments({
          ...regionQuery,
          status: 'delivered'
        }),

        Order.countDocuments({
          ...regionQuery,
          status: 'failed_delivery'
        })
      ]);

      const completedDeliveries =
        deliveredOrders +
        failedDeliveries;

      const deliverySuccessRate =
        completedDeliveries > 0
          ? Number(
              (
                (
                  deliveredOrders /
                  completedDeliveries
                ) * 100
              ).toFixed(1)
            )
          : null;

      context.regionHistory = {
        region: regionName,
        completedDeliveries,
        deliveredOrders,
        failedDeliveries,
        deliverySuccessRate
      };
    }

    // ======================================================
    // HISTORIQUE HORAIRE
    // ======================================================

    const currentHour =
      this.getTunisiaOrderHour(order);

    if (currentHour !== null) {
      const completedQuery = {
        ...baseShopQuery,

        status: {
          $in: [
            'delivered',
            'failed_delivery'
          ]
        }
      };

      const [
        overallDelivered,
        overallFailed,
        sameHourStats
      ] = await Promise.all([
        Order.countDocuments({
          ...baseShopQuery,
          status: 'delivered'
        }),

        Order.countDocuments({
          ...baseShopQuery,
          status: 'failed_delivery'
        }),

        Order.aggregate([
          {
            $match: completedQuery
          },

          {
            $project: {
              status: 1,

              localHour: {
                $hour: {
                  date: '$createdAt',
                  timezone: 'Africa/Tunis'
                }
              }
            }
          },

          {
            $match: {
              localHour: currentHour
            }
          },

          {
            $group: {
              _id: null,

              completed: {
                $sum: 1
              },

              failed: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        '$status',
                        'failed_delivery'
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ])
      ]);

      const overallCompleted =
        overallDelivered +
        overallFailed;

      const overallFailureRate =
        overallCompleted > 0
          ? Number(
              (
                (
                  overallFailed /
                  overallCompleted
                ) * 100
              ).toFixed(1)
            )
          : null;

      const hourStats =
        sameHourStats[0] || null;

      const sameHourCompleted =
        hourStats?.completed || 0;

      const sameHourFailed =
        hourStats?.failed || 0;

      const sameHourFailureRate =
        sameHourCompleted > 0
          ? Number(
              (
                (
                  sameHourFailed /
                  sameHourCompleted
                ) * 100
              ).toFixed(1)
            )
          : null;

      context.orderTimeHistory = {
        hour: currentHour,
        sameHourCompleted,
        sameHourFailed,
        sameHourFailureRate,
        overallCompleted,
        overallFailed,
        overallFailureRate
      };
    }

    return context;
  }

  /**
   * PDF : historique de livraisons réussies.
   */
  calculateCustomerSuccessAdjustment(
    count,
    scoringConfig = null
  ) {
    const value =
      Number(count) || 0;

    /*
     * Historical fallback.
     */
    if (!scoringConfig) {
      if (value >= 11) return 10;
      if (value >= 7) return 8;
      if (value >= 4) return 6;
      if (value >= 2) return 4;
      if (value >= 1) return 2;

      return 0;
    }

    const customerHistory =
      scoringConfig.customerHistory || null;

    const successConfig =
      customerHistory?.successfulDeliveries ||
      null;

    if (
      !customerHistory ||
      customerHistory.enabled === false ||
      !successConfig ||
      successConfig.enabled === false
    ) {
      return 0;
    }

    const rules =
      Array.isArray(
        successConfig.rules
      )
        ? successConfig.rules
        : [];

    const enabledRules =
      rules
        .filter(
          rule =>
            rule.enabled !== false
        )
        .sort(
          (a, b) =>
            Number(a.order || 0) -
            Number(b.order || 0)
        );

    for (const rule of enabledRules) {
      const hasMin =
        Number.isFinite(rule.min);

      const hasMax =
        Number.isFinite(rule.max);

      const minMatches =
        !hasMin ||
        (
          rule.includeMin === false
            ? value > rule.min
            : value >= rule.min
        );

      const maxMatches =
        !hasMax ||
        (
          rule.includeMax === false
            ? value < rule.max
            : value <= rule.max
        );

      if (
        minMatches &&
        maxMatches
      ) {
        return Number.isFinite(
          rule.impact
        )
          ? rule.impact
          : 0;
      }
    }

    return 0;
  }

  /**
   * PDF : historique d'échecs de livraison.
   */
  calculateCustomerFailureAdjustment(
    count,
    scoringConfig = null
  ) {
    const value =
      Number(count) || 0;

    /*
     * Historical fallback.
     */
    if (!scoringConfig) {
      if (value >= 6) return -15;
      if (value >= 4) return -12;
      if (value >= 3) return -9;
      if (value >= 2) return -6;
      if (value >= 1) return -3;

      return 0;
    }

    const customerHistory =
      scoringConfig.customerHistory || null;

    const failureConfig =
      customerHistory?.failedDeliveries ||
      null;

    if (
      !customerHistory ||
      customerHistory.enabled === false ||
      !failureConfig ||
      failureConfig.enabled === false
    ) {
      return 0;
    }

    const rules =
      Array.isArray(
        failureConfig.rules
      )
        ? failureConfig.rules
        : [];

    const enabledRules =
      rules
        .filter(
          rule =>
            rule.enabled !== false
        )
        .sort(
          (a, b) =>
            Number(a.order || 0) -
            Number(b.order || 0)
        );

    for (const rule of enabledRules) {
      const hasMin =
        Number.isFinite(rule.min);

      const hasMax =
        Number.isFinite(rule.max);

      const minMatches =
        !hasMin ||
        (
          rule.includeMin === false
            ? value > rule.min
            : value >= rule.min
        );

      const maxMatches =
        !hasMax ||
        (
          rule.includeMax === false
            ? value < rule.max
            : value <= rule.max
        );

      if (
        minMatches &&
        maxMatches
      ) {
        return Number.isFinite(
          rule.impact
        )
          ? rule.impact
          : 0;
      }
    }

    return 0;
  }

  /**
   * PDF : qualité d'adresse.
   *
   * Adresse complète = rue + ville + gouvernorat.
   * Cette définition reprend les contrôles d'adresse déjà
   * utilisés par CONFIRMED.
   */
  calculateAddressAdjustment(
    order,
    scoringConfig = null
  ) {
    const address =
      order.clientInfo?.address || {};

    const street = String(
      address.street || ''
    ).trim();

    const city = String(
      address.city || ''
    ).trim();

    /*
     * Governorate used by the historical/exclusive address
     * quality logic.
     *
     * CONFIRMED may resolve it from other address data,
     * so we preserve that historical behavior.
     */
    const state = String(
      resolveTunisiaGovernorate(order) ||
      address.state ||
      order.region ||
      ''
    ).trim();

    /*
     * Governorate explicitly supplied with the order.
     *
     * In cumulative mode, City and Governorate are separate
     * configurable components. A city must therefore not
     * automatically earn the Governorate points as well.
     */
    const explicitGovernorate = String(
      address.state ||
      order.region ||
      ''
    ).trim();

    const postalCode = String(
      address.zipCode ||
      address.postalCode ||
      ''
    ).trim();

    /*
     * Detect address quality exactly as the historical
     * engine did.
     *
     * complete = street + city + governorate
     * partial  = at least one of them
     * missing  = none
     */
    let addressState = 'missing';

    if (street && city && state) {
      addressState = 'complete';
    } else if (
      street ||
      city ||
      state
    ) {
      addressState = 'partial';
    }

    /*
     * Safe historical fallback.
     *
     * calculateAIScore() can still be called without a
     * database configuration, so the old behavior must
     * remain available.
     */
    if (!scoringConfig) {
      const historicalImpacts = {
        complete: 6,
        partial: -3,
        missing: -10
      };

      return {
        adjustment:
          historicalImpacts[
            addressState
          ],
        state: addressState
      };
    }

    const patterns =
      scoringConfig.patterns || {};

    const addressConfig =
      patterns.address || null;

    /*
     * The whole Pattern group or Address category can be
     * disabled by the Admin.
     */
    if (
      patterns.enabled === false ||
      !addressConfig ||
      addressConfig.enabled === false
    ) {
      return {
        adjustment: 0,
        state: addressState
      };
    }

    /*
     * EXCLUSIVE MODE
     *
     * Apply only one level:
     * complete / partial / missing.
     */
    if (
      addressConfig.mode !==
      'cumulative'
    ) {
      const levels =
        Array.isArray(
          addressConfig.levels
        )
          ? addressConfig.levels
          : [];

      const rule =
        levels.find(
          item =>
            item.key ===
            addressState
        );

      if (
        !rule ||
        rule.enabled === false ||
        !Number.isFinite(
          rule.impact
        )
      ) {
        return {
          adjustment: 0,
          state: addressState
        };
      }

      return {
        adjustment:
          rule.impact,
        state: addressState
      };
    }

    /*
     * CUMULATIVE MODE
     *
     * Each enabled address component contributes its
     * configured impact when that component is present.
     */
    const elements =
      addressConfig.elements || {};

    const componentValues = {
      street,
      city,
      governorate:
        explicitGovernorate,
      postalCode
    };

    let adjustment = 0;

    for (
      const [
        key,
        value
      ] of Object.entries(
        componentValues
      )
    ) {
      const rule =
        elements[key];

      if (
        !value ||
        !rule ||
        rule.enabled === false ||
        !Number.isFinite(
          rule.impact
        )
      ) {
        continue;
      }

      adjustment +=
        rule.impact;
    }

    return {
      adjustment,
      state: addressState
    };
  }

  /**
   * PDF : montant absolu de la commande.
   *
   * La deuxième règle du PDF compare également la commande
   * aux habitudes historiques. Aucun seuil numérique
   * permettant de définir "légèrement supérieure",
   * "élevée" ou "très élevée" n'est fourni.
   * Elle reste donc neutre en V1 plutôt que d'inventer
   * des seuils.
   */
  calculateOrderAmountAdjustment(
    amount,
    scoringConfig = null
  ) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
      return 0;
    }

    /*
     * Historical fallback.
     *
     * This preserves the exact previous behavior when
     * calculateAIScore() is called without a DB config.
     */
    if (!scoringConfig) {
      if (value < 30) return -1;
      if (value < 150) return 0;
      if (value < 250) return -1;
      if (value < 400) return -3;
      if (value < 600) return -5;

      return -6;
    }

    const patterns =
      scoringConfig.patterns || {};

    const orderValue =
      patterns.orderValue || null;

    const absoluteValue =
      orderValue?.absoluteValue || null;

    /*
     * Admin can disable:
     * - all Patterns;
     * - Order Value;
     * - Absolute Value specifically.
     */
    if (
      patterns.enabled === false ||
      !orderValue ||
      orderValue.enabled === false ||
      !absoluteValue ||
      absoluteValue.enabled === false
    ) {
      return 0;
    }

    const rules =
      Array.isArray(
        absoluteValue.rules
      )
        ? absoluteValue.rules
        : [];

    const enabledRules =
      rules
        .filter(
          rule =>
            rule.enabled !== false
        )
        .sort(
          (a, b) =>
            Number(a.order || 0) -
            Number(b.order || 0)
        );

    for (const rule of enabledRules) {
      const hasMin =
        Number.isFinite(rule.min);

      const hasMax =
        Number.isFinite(rule.max);

      const minMatches =
        !hasMin ||
        (
          rule.includeMin === false
            ? value > rule.min
            : value >= rule.min
        );

      const maxMatches =
        !hasMax ||
        (
          rule.includeMax === false
            ? value < rule.max
            : value <= rule.max
        );

      if (
        minMatches &&
        maxMatches
      ) {
        return Number.isFinite(
          rule.impact
        )
          ? rule.impact
          : 0;
      }
    }

    /*
     * Activation validation is designed to prevent gaps,
     * but if no active rule matches for any reason, fail
     * safely with no adjustment.
     */
    return 0;
  }

  /**
   * Heure locale tunisienne utilisée par le PDF.
   */
  getTunisiaOrderHour(order) {
    const date =
      order.createdAt
        ? new Date(order.createdAt)
        : new Date();

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone: 'Africa/Tunis',
          hour: '2-digit',
          hour12: false
        }
      ).formatToParts(date);

    const hourPart =
      parts.find(part => part.type === 'hour');

    if (!hourPart) {
      return null;
    }

    const hour = Number(hourPart.value);

    if (!Number.isFinite(hour)) {
      return null;
    }

    return hour % 24;
  }

  /**
   * Minute locale tunisienne depuis minuit.
   *
   * Exemple :
   * 08:30 -> 510
   * 22:00 -> 1320
   *
   * Cette valeur permet aux règles Admin d'utiliser
   * des créneaux plus précis qu'une heure entière.
   */
  getTunisiaOrderMinuteOfDay(order) {
    const date =
      order.createdAt
        ? new Date(order.createdAt)
        : new Date();

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone: 'Africa/Tunis',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }
      ).formatToParts(date);

    const hourPart =
      parts.find(
        part =>
          part.type === 'hour'
      );

    const minutePart =
      parts.find(
        part =>
          part.type === 'minute'
      );

    if (
      !hourPart ||
      !minutePart
    ) {
      return null;
    }

    const hour =
      Number(hourPart.value) % 24;

    const minute =
      Number(minutePart.value);

    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute)
    ) {
      return null;
    }

    return (
      hour * 60 +
      minute
    );
  }

  /**
   * PDF : heure de commande.
   */
  calculateOrderTimeAdjustment(
    order,
    scoringConfig = null
  ) {
    const hour =
      this.getTunisiaOrderHour(order);

    const minuteOfDay =
      this.getTunisiaOrderMinuteOfDay(
        order
      );

    if (
      hour === null ||
      minuteOfDay === null
    ) {
      return {
        adjustment: 0,
        hour: null,
        minuteOfDay: null,
        state: 'invalid_time'
      };
    }

    /*
     * Historical fallback.
     *
     * Preserve the exact old behavior when no DB config
     * is provided.
     */
    if (!scoringConfig) {
      if (
        hour >= 8 &&
        hour < 22
      ) {
        return {
          adjustment: 0,
          hour,
          minuteOfDay,
          state: '08_22'
        };
      }

      if (hour >= 22) {
        return {
          adjustment: -1,
          hour,
          minuteOfDay,
          state: '22_24'
        };
      }

      if (hour < 2) {
        return {
          adjustment: -2,
          hour,
          minuteOfDay,
          state: '00_02'
        };
      }

      if (hour < 6) {
        return {
          adjustment: -3,
          hour,
          minuteOfDay,
          state: '02_06'
        };
      }

      return {
        adjustment: -1,
        hour,
        minuteOfDay,
        state: '06_08'
      };
    }

    const patterns =
      scoringConfig.patterns || {};

    const orderTime =
      patterns.orderTime || null;

    /*
     * Admin can disable either all Patterns or only the
     * Order Time category.
     */
    if (
      patterns.enabled === false ||
      !orderTime ||
      orderTime.enabled === false
    ) {
      return {
        adjustment: 0,
        hour,
        minuteOfDay,
        state: 'disabled'
      };
    }

    const rules =
      Array.isArray(
        orderTime.rules
      )
        ? orderTime.rules
        : [];

    const enabledRules =
      rules
        .filter(
          rule =>
            rule.enabled !== false
        )
        .sort(
          (a, b) =>
            Number(a.order || 0) -
            Number(b.order || 0)
        );

    for (const rule of enabledRules) {
      const startMinute =
        Number(rule.startMinute);

      const endMinute =
        Number(rule.endMinute);

      if (
        !Number.isFinite(startMinute) ||
        !Number.isFinite(endMinute)
      ) {
        continue;
      }

      /*
       * Time ranges use:
       * start inclusive
       * end exclusive
       *
       * Example:
       * 08:00–22:00 means
       * >= 480 and < 1320.
       */
      if (
        minuteOfDay >= startMinute &&
        minuteOfDay < endMinute
      ) {
        return {
          adjustment:
            Number.isFinite(rule.impact)
              ? rule.impact
              : 0,

          hour,
          minuteOfDay,

          state:
            rule.key ||
            'matched'
        };
      }
    }

    /*
     * Activation validation normally guarantees full
     * 00:00–24:00 coverage.
     *
     * If malformed data reaches the engine anyway,
     * fail safely without changing the score.
     */
    return {
      adjustment: 0,
      hour,
      minuteOfDay,
      state: 'unmatched'
    };
  }

  /**
   * Zone géographique historique.
   *
   * Convention V1 :
   * moins de 20 livraisons terminées = historique insuffisant.
   */
  calculateRegionHistoryAdjustment(history) {
    const completed =
      Number(
        history?.completedDeliveries
      ) || 0;

    const successRate =
      Number(
        history?.deliverySuccessRate
      );

    if (
      completed < 20 ||
      !Number.isFinite(successRate)
    ) {
      return {
        adjustment: 0,
        state: 'insufficient'
      };
    }

    if (successRate >= 90) {
      return {
        adjustment: 5,
        state: 'excellent'
      };
    }

    if (successRate >= 80) {
      return {
        adjustment: 3,
        state: 'good'
      };
    }

    if (successRate >= 65) {
      return {
        adjustment: 0,
        state: 'medium'
      };
    }

    if (successRate >= 50) {
      return {
        adjustment: -4,
        state: 'weak'
      };
    }

    return {
      adjustment: -7,
      state: 'very_weak'
    };
  }

  /**
   * Montant relatif aux habitudes du client.
   *
   * Convention V1 :
   * minimum 3 commandes historiques.
   */
  calculateOrderAmountHistoryAdjustment(
    amount,
    history,
    scoringConfig = null
  ) {
    const orderCount =
      Number(
        history?.orderCount
      ) || 0;

    const average =
      Number(
        history?.averageOrderValue
      );

    const current =
      Number(amount);

    /*
     * Historical fallback configuration.
     *
     * This keeps the previous scoring behavior available
     * when no database configuration is supplied.
     */
    if (!scoringConfig) {
      if (
        orderCount < 3 ||
        !Number.isFinite(average) ||
        average <= 0 ||
        !Number.isFinite(current)
      ) {
        return {
          adjustment: 0,
          state: 'insufficient',
          ratio: null
        };
      }

      const ratio =
        current / average;

      if (ratio < 0.5) {
        return {
          adjustment: -1,
          state: 'very_low',
          ratio
        };
      }

      if (ratio <= 1.25) {
        return {
          adjustment: 0,
          state: 'normal',
          ratio
        };
      }

      if (ratio <= 1.5) {
        return {
          adjustment: -1,
          state: 'slightly_above',
          ratio
        };
      }

      if (ratio <= 2) {
        return {
          adjustment: -3,
          state: 'high',
          ratio
        };
      }

      return {
        adjustment: -5,
        state: 'very_high',
        ratio
      };
    }

    const patterns =
      scoringConfig.patterns || {};

    const orderValue =
      patterns.orderValue || null;

    const relativeConfig =
      orderValue?.relativeToHistory || null;

    /*
     * Admin can disable:
     * - all Patterns;
     * - Order Value;
     * - Relative To History specifically.
     */
    if (
      patterns.enabled === false ||
      !orderValue ||
      orderValue.enabled === false ||
      !relativeConfig ||
      relativeConfig.enabled === false
    ) {
      return {
        adjustment: 0,
        state: 'disabled',
        ratio: null
      };
    }

    const minimumHistoricalOrders =
      Number.isFinite(
        relativeConfig.minimumHistoricalOrders
      )
        ? relativeConfig.minimumHistoricalOrders
        : 3;

    if (
      orderCount <
        minimumHistoricalOrders ||
      !Number.isFinite(average) ||
      average <= 0 ||
      !Number.isFinite(current)
    ) {
      return {
        adjustment: 0,
        state: 'insufficient',
        ratio: null
      };
    }

    const ratio =
      current / average;

    const rules =
      Array.isArray(
        relativeConfig.rules
      )
        ? relativeConfig.rules
        : [];

    const enabledRules =
      rules
        .filter(
          rule =>
            rule.enabled !== false
        )
        .sort(
          (a, b) =>
            Number(a.order || 0) -
            Number(b.order || 0)
        );

    for (const rule of enabledRules) {
      const hasMin =
        Number.isFinite(rule.min);

      const hasMax =
        Number.isFinite(rule.max);

      const minMatches =
        !hasMin ||
        (
          rule.includeMin === false
            ? ratio > rule.min
            : ratio >= rule.min
        );

      const maxMatches =
        !hasMax ||
        (
          rule.includeMax === false
            ? ratio < rule.max
            : ratio <= rule.max
        );

      if (
        minMatches &&
        maxMatches
      ) {
        return {
          adjustment:
            Number.isFinite(rule.impact)
              ? rule.impact
              : 0,

          state:
            rule.key ||
            'matched',

          ratio
        };
      }
    }

    /*
     * The activation validator should prevent gaps.
     * If a malformed config still reaches the engine,
     * fail safely without changing the score.
     */
    return {
      adjustment: 0,
      state: 'unmatched',
      ratio
    };
  }

  /**
   * Historique horaire des échecs de livraison.
   *
   * Convention V1 :
   * - minimum 5 livraisons terminées à cette heure ;
   * - taux d'échec >= 30 % ;
   * - au moins 15 points au-dessus du taux global
   *   de la boutique.
   */
  calculateOrderTimeHistoryAdjustment(
    history,
    scoringConfig = null
  ) {
    const sameHourCompleted =
      Number(
        history?.sameHourCompleted
      ) || 0;

    const sameHourFailureRate =
      Number(
        history?.sameHourFailureRate
      );

    const overallFailureRate =
      Number(
        history?.overallFailureRate
      );

    /*
     * Historical fallback.
     *
     * Preserve the exact previous behavior when no
     * active database configuration is provided.
     */
    if (!scoringConfig) {
      if (
        sameHourCompleted < 5 ||
        !Number.isFinite(
          sameHourFailureRate
        ) ||
        !Number.isFinite(
          overallFailureRate
        )
      ) {
        return {
          adjustment: 0,
          state: 'insufficient'
        };
      }

      const excessFailureRate =
        sameHourFailureRate -
        overallFailureRate;

      if (
        sameHourFailureRate >= 30 &&
        excessFailureRate >= 15
      ) {
        return {
          adjustment: -3,
          state: 'historically_risky'
        };
      }

      return {
        adjustment: 0,
        state: 'normal'
      };
    }

    const patterns =
      scoringConfig.patterns || {};

    const orderTime =
      patterns.orderTime || null;

    const historicalSignal =
      orderTime?.historicalSignal || null;

    /*
     * Admin can disable:
     * - all Patterns;
     * - Order Time;
     * - only the historical signal.
     */
    if (
      patterns.enabled === false ||
      !orderTime ||
      orderTime.enabled === false ||
      !historicalSignal ||
      historicalSignal.enabled === false
    ) {
      return {
        adjustment: 0,
        state: 'disabled'
      };
    }

    const minimumCompletedOrders =
      Number.isFinite(
        historicalSignal
          .minimumCompletedOrders
      )
        ? historicalSignal
            .minimumCompletedOrders
        : 5;

    const minimumFailureRate =
      Number.isFinite(
        historicalSignal
          .minimumFailureRate
      )
        ? historicalSignal
            .minimumFailureRate
        : 30;

    const minimumExcessFailureRate =
      Number.isFinite(
        historicalSignal
          .minimumExcessFailureRate
      )
        ? historicalSignal
            .minimumExcessFailureRate
        : 15;

    const configuredImpact =
      Number.isFinite(
        historicalSignal.impact
      )
        ? historicalSignal.impact
        : -3;

    if (
      sameHourCompleted <
        minimumCompletedOrders ||
      !Number.isFinite(
        sameHourFailureRate
      ) ||
      !Number.isFinite(
        overallFailureRate
      )
    ) {
      return {
        adjustment: 0,
        state: 'insufficient'
      };
    }

    const excessFailureRate =
      sameHourFailureRate -
      overallFailureRate;

    if (
      sameHourFailureRate >=
        minimumFailureRate &&
      excessFailureRate >=
        minimumExcessFailureRate
    ) {
      return {
        adjustment:
          configuredImpact,
        state:
          'historically_risky'
      };
    }

    return {
      adjustment: 0,
      state: 'normal'
    };
  }

  /**
   * Calculate AI score according to Scoring IA PDF.
   *
   * Base     : 65
   * Minimum  : 20
   * Maximum  : 97
   */
  calculateAIScore(
    order,
    context = {},
    scoringConfig = null
  ) {
    /*
     * General score limits now come from the active
     * database configuration.
     *
     * The historical values remain as safe fallbacks so
     * scoring continues to work if no active config is
     * available.
     */
    const general =
      scoringConfig?.general || {};

    const baseScore =
      Number.isFinite(general.baseScore)
        ? general.baseScore
        : 65;

    const minimumScore =
      Number.isFinite(general.minimumScore)
        ? general.minimumScore
        : 20;

    const maximumScore =
      Number.isFinite(general.maximumScore)
        ? general.maximumScore
        : 97;

    let score = baseScore;

    const factors = [];

    // =====================================================
    // 1. ADRESSE
    // =====================================================

    const addressResult =
      this.calculateAddressAdjustment(
        order,
        scoringConfig
      );

    score += addressResult.adjustment;

    factors.push({
      key: 'address',
      label: 'Adresse',
      value: addressResult.state,
      impact: addressResult.adjustment,
      applied: addressResult.adjustment !== 0
    });

    // =====================================================
    // 2. ZONE GEOGRAPHIQUE
    // =====================================================

    const regionHistory =
      this.calculateRegionHistoryAdjustment(
        context.regionHistory
      );

    score +=
      regionHistory.adjustment;

    factors.push({
      key: 'region',
      label: 'Zone géographique',
      value:
        context.regionHistory?.region ||
        resolveTunisiaGovernorate(order) ||
        order.region ||
        order.clientInfo?.address?.state ||
        order.clientInfo?.address?.city ||
        '',
      impact:
        regionHistory.adjustment,
      applied:
        regionHistory.adjustment !== 0
    });

    // =====================================================
    // 3. VALEUR DE COMMANDE
    // =====================================================

    const amountAdjustment =
      this.calculateOrderAmountAdjustment(
        order.totalAmount,
        scoringConfig
      );

    score += amountAdjustment;

    factors.push({
      key: 'order_amount',
      label: 'Valeur totale de la commande',
      value: order.totalAmount,
      impact: amountAdjustment,
      applied: amountAdjustment !== 0
    });

    const amountHistory =
      this.calculateOrderAmountHistoryAdjustment(
        order.totalAmount,
        context.orderValueHistory,
        scoringConfig
      );

    score +=
      amountHistory.adjustment;

    factors.push({
      key: 'order_amount_history',
      label: 'Valeur par rapport aux commandes habituelles',
      value:
        amountHistory.ratio === null
          ? amountHistory.state
          : `${Math.round(
              amountHistory.ratio * 100
            )}% de la moyenne client`,
      impact:
        amountHistory.adjustment,
      applied:
        amountHistory.adjustment !== 0
    });

    // =====================================================
    // 4. HEURE DE COMMANDE
    // =====================================================

    const timeResult =
      this.calculateOrderTimeAdjustment(
        order,
        scoringConfig
      );

    const timeHistory =
      this.calculateOrderTimeHistoryAdjustment(
        context.orderTimeHistory,
        scoringConfig
      );

    /*
     * Les deux signaux évaluent le même critère horaire.
     * On applique uniquement la pénalité la plus forte,
     * afin de ne pas compter deux fois le même risque.
     */
    const historicalTimeIsStronger =
      timeHistory.adjustment <
      timeResult.adjustment;

    const fixedTimeImpact =
      historicalTimeIsStronger
        ? 0
        : timeResult.adjustment;

    const historicalTimeImpact =
      historicalTimeIsStronger
        ? timeHistory.adjustment
        : 0;

    score +=
      Math.min(
        timeResult.adjustment,
        timeHistory.adjustment
      );

    factors.push({
      key: 'order_time',
      label: 'Heure de commande',
      value:
        timeResult.hour === null
          ? null
          : `${String(
              timeResult.hour
            ).padStart(2, '0')}:00`,
      impact: fixedTimeImpact,
      applied:
        fixedTimeImpact !== 0
    });

    factors.push({
      key: 'order_time_history',
      label: 'Historique de l’heure de commande',
      value: timeHistory.state,
      impact: historicalTimeImpact,
      applied:
        historicalTimeImpact !== 0
    });

    // =====================================================
    // 5. HISTORIQUE CLIENT
    // =====================================================

    const successfulDeliveries =
      Number(
        context.customerHistory
          ?.successfulDeliveries
      ) || 0;

    const failedDeliveries =
      Number(
        context.customerHistory
          ?.failedDeliveries
      ) || 0;

    const successAdjustment =
      this.calculateCustomerSuccessAdjustment(
        successfulDeliveries,
        scoringConfig
      );

    const failureAdjustment =
      this.calculateCustomerFailureAdjustment(
        failedDeliveries,
        scoringConfig
      );

    score += successAdjustment;
    score += failureAdjustment;

    factors.push({
      key: 'customer_success_history',
      label: 'Livraisons réussies du client',
      value: successfulDeliveries,
      impact: successAdjustment,
      applied: successAdjustment !== 0
    });

    factors.push({
      key: 'customer_failure_history',
      label: 'Échecs de livraison du client',
      value: failedDeliveries,
      impact: failureAdjustment,
      applied: failureAdjustment !== 0
    });

    // =====================================================
    // 6. RETOUR OPERATEUR
    // =====================================================

    const operatorBehavior =
      this.calculateOperatorFeedbackAdjustment(
        order.operatorFeedback
      );

    score += operatorBehavior.adjustment;

    factors.push({
      key: 'operator_feedback',
      label: 'Retour comportemental opérateur',
      value: operatorBehavior.summary,
      impact: operatorBehavior.adjustment,
      applied: operatorBehavior.applied
    });

    // =====================================================
    // FINAL
    // =====================================================

    /*
     * Keep the exact historical scoring behavior:
     * round first, then clamp.
     *
     * calculatedScore is the value before the clamp.
     */
    const calculatedScore =
      Math.round(score);

    const finalScore =
      Math.max(
        minimumScore,
        Math.min(
          maximumScore,
          calculatedScore
        )
      );

    return {
      baseScore,
      calculatedScore,
      minimumScore,
      maximumScore,
      score: finalScore,
      factors
    };
  }

  /**
   * Convert score to risk level
   */
  calculateRiskLevel(score) {
    if (score <= 20) {
      return 'critical';
    }

    if (score <= 40) {
      return 'high';
    }

    if (score <= 60) {
      return 'medium';
    }

    if (score <= 80) {
      return 'low';
    }

    return 'very_low';
  }

  /**
   * Convert score to AI decision
   */
  calculateDecision(score) {
    if (score < 40) {
      return 'reject';
    }

    if (score <= 70) {
      return 'review';
    }

    return 'accept';
  }

  /**
   * Generate address-quality findings from real order data.
   * These findings are descriptive only for now and do not
   * modify the numerical AI score.
   */
  generateAddressFindings(order) {
    const address = order.clientInfo?.address || {};

    const street = (address.street || '').trim();
    const city = (address.city || '').trim();
    const state = (
      resolveTunisiaGovernorate(order) ||
      address.state ||
      order.region ||
      ''
    ).trim();
    const zipCode = (address.zipCode || '').trim();

    const findings = [];

    const hasStreet = street.length > 0;
    const hasStreetNumber = /\d+/.test(street);
    const hasCity = city.length > 0;
    const hasState = state.length > 0;
    const hasZipCode = zipCode.length > 0;

    const vagueAddress =
      /\b(pr[eè]s de|chez|[àa] c[oô]t[eé] de|derri[eè]re|devant)\b/i.test(street);

    if (hasStreet && hasCity && hasState) {
      findings.push({
        key: 'address_complete',
        level: 'positive',
        description: 'Adresse complète et précise.',
        impact: 'positive'
      });
    } else if (hasStreet || hasCity || hasState) {
      findings.push({
        key: 'address_partial',
        level: 'neutral',
        description: 'Adresse partiellement renseignée.',
        impact: 'neutral'
      });
    } else {
      findings.push({
        key: 'address_incomplete',
        level: 'alert',
        description: 'Adresse incomplète.',
        impact: 'negative'
      });
    }

    if (hasStreet) {
      findings.push({
        key: 'street_present',
        level: 'positive',
        description: 'Rue renseignée.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'street_missing',
        level: 'alert',
        description: 'Rue absente.',
        impact: 'negative'
      });
    }

    if (hasStreetNumber) {
      findings.push({
        key: 'street_number_present',
        level: 'positive',
        description: 'Numéro de rue renseigné.',
        impact: 'positive'
      });
    } else if (hasStreet) {
      findings.push({
        key: 'street_number_missing',
        level: 'neutral',
        description: 'Numéro de rue manquant.',
        impact: 'neutral'
      });
    }

    if (hasCity) {
      findings.push({
        key: 'city_present',
        level: 'positive',
        description: 'Ville correctement renseignée.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'city_missing',
        level: 'alert',
        description: 'Ville absente.',
        impact: 'negative'
      });
    }

    if (hasState) {
      findings.push({
        key: 'state_present',
        level: 'positive',
        description: 'Gouvernorat identifié.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'state_missing',
        level: 'alert',
        description: 'Gouvernorat absent.',
        impact: 'negative'
      });
    }

    if (hasZipCode) {
      findings.push({
        key: 'zip_present',
        level: 'positive',
        description: 'Code postal renseigné.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'zip_missing',
        level: 'neutral',
        description: 'Code postal non renseigné.',
        impact: 'neutral'
      });
    }

    if (vagueAddress) {
      findings.push({
        key: 'address_vague',
        level: 'alert',
        description: 'Adresse imprécise avec une description vague.',
        impact: 'negative'
      });
    }

    return findings;
  }

  /**
   * Generate an automatic AI summary strictly from factors
   * that were actually used by the scoring engine.
   */
  generateSummary(order) {
    const factors = order.aiScoreDetails?.factors || [];

    const positiveFactors = factors.filter(
      factor => factor.applied === true && factor.impact > 0
    );

    const negativeFactors = factors.filter(
      factor => factor.applied === true && factor.impact < 0
    );

    const probabilityText =
      order.aiScore >= 81
        ? 'Cette commande présente une très forte probabilité de livraison.'
        : order.aiScore >= 61
          ? 'Cette commande présente une bonne probabilité de livraison.'
          : order.aiScore >= 41
            ? 'Cette commande présente une probabilité de livraison modérée.'
            : 'Cette commande présente un risque important nécessitant une vigilance particulière.';

    const riskLabels = {
      very_low: 'très faible',
      low: 'faible',
      medium: 'modéré',
      high: 'élevé',
      critical: 'critique'
    };

    const decisionLabels = {
      accept: 'Expédition recommandée',
      review: 'Décision du vendeur',
      reject: 'Expédition déconseillée'
    };

    return {
      introduction: probabilityText,

      positiveFactors: positiveFactors.map(factor => ({
        key: factor.key,
        label: factor.label,
        value: factor.value,
        impact: factor.impact
      })),

      warningFactors: negativeFactors.map(factor => ({
        key: factor.key,
        label: factor.label,
        value: factor.value,
        impact: factor.impact
      })),

      conclusion: `Le niveau de risque global est ${riskLabels[order.riskLevel] || 'non déterminé'}.`,

      recommendation:
        decisionLabels[order.aiDecision] || 'Décision non déterminée'
    };
  }

  /**
   * Populate AI fields
   */
  async enrichOrder(order) {
    /*
     * Load the active scoring configuration once for this
     * entire scoring operation.
     *
     * This prevents a single order from being calculated
     * partly with one version and partly with another.
     */
    const scoringConfigContext =
      await aiScoringConfigService
        .getActiveScoringContext();

    const context =
      await this.buildScoringContext(order);

    const result =
      this.calculateAIScore(
        order,
        context,
        scoringConfigContext.config
      );

    order.aiScore = result.score;
    order.riskLevel =
      this.calculateRiskLevel(result.score);
    order.aiDecision =
      this.calculateDecision(result.score);
    order.aiScoredAt = new Date();

    order.aiScoreDetails = {
      configVersion:
        scoringConfigContext
          .config?.version ?? null,

      configSnapshot:
        scoringConfigContext.snapshot,

      baseScore: result.baseScore,
      calculatedScore:
        result.calculatedScore,
      minimumScore:
        result.minimumScore,
      maximumScore:
        result.maximumScore,
      finalScore: result.score,
      factors: result.factors
    };

    return order;
  }
}

module.exports = new AIScoringService();
