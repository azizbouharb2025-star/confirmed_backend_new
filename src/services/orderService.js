const Order = require('../models/Order');
const logger = require('../utils/logger');
const { emitOrderUpdate, emitOrderNew, emitOrderDelete } = require('../websocket/orderEvents');
const { logActivity } = require('./activityLogService');
const aiScoringService = require('./aiScoringService');

class OrderService {
  /**
   * Create a new order
   * Emits order:new WebSocket event on success
   * **Validates: Requirements 11.2**
   * 
   * @param {Object} orderData - Order data
   * @returns {Promise<Object>} Created order
   */
  async createOrder(orderData) {
    const order = new Order(orderData);

    // Calculate and persist the AI score for every new order.
    aiScoringService.enrichOrder(order);

    await order.save();

    // Emit WebSocket event for real-time updates
    emitOrderNew(order);

    // Log activity
    await logActivity('order', 'Nouvelle commande reçue', `#${order.confirmedId || order.orderId}`);

    return order;
  }

  /**
   * Find orders with pagination, filtering, search, and sorting
   * @param {Object} filters - Filter parameters
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Paginated result with orders, total, page, limit, totalPages
   */
  async findOrders(filters = {}, user = {}) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      // Tier-specific filters (handled by tier middleware)
      aiScoreMin,
      aiScoreMax,
      aiDecision,
      riskLevel,
      region,
      courier,
      // New filters
      filter,
      hasComplaint,
      // Admin-only filter
      shopId
    } = filters;

    // Ensure pagination values are within bounds
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    // Build query
    const query = {};

    // Shop filter - non-admin users can only see their own shop's orders
    if (user.role === 'admin' && shopId) {
      query.shopId = shopId;
    } else if (user.shopId) {
      query.shopId = user.shopId;
    }

    // Search across orderId, clientInfo.name, clientInfo.phone
    if (search) {
      // Escape special regex characters to prevent regex injection
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      query.$or = [
        { orderId: searchRegex },
        { 'clientInfo.name': searchRegex },
        { 'clientInfo.phone': searchRegex }
      ];
    }


    // Status filter
    if (status) {
      query.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Pro tier filters - AI score range
    if (aiScoreMin !== undefined || aiScoreMax !== undefined) {
      query.aiScore = {};
      if (aiScoreMin !== undefined) {
        query.aiScore.$gte = Number(aiScoreMin);
      }
      if (aiScoreMax !== undefined) {
        query.aiScore.$lte = Number(aiScoreMax);
      }
    }

    // AI decision filter
    if (['accept', 'review', 'reject'].includes(aiDecision)) {
      query.aiDecision = aiDecision;
    }

    // AI risk level filter
    if (['critical', 'high', 'medium', 'low', 'very_low'].includes(riskLevel)) {
      query.riskLevel = riskLevel;
    }

    // Special filter for risky orders
    if (filter === 'risky') {
      query.aiScore = { $lt: 50 };
    }

    // Business tier filters
    if (region) {
      query.region = region;
    }
    if (courier) {
      query.courier = courier;
    }

    // Complaint filter
    if (hasComplaint === 'true' || hasComplaint === true) {
      query.hasComplaint = true;
    }

    // Build sort object
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: sortDirection };

    try {
      // Get total count for pagination
      const total = await Order.countDocuments(query);

      // Calculate total pages
      const totalPages = Math.ceil(total / limitNum);

      // Get paginated orders
      const orders = await Order.find(query)
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('assignedOperatorId', 'name email')
        .populate('shopId', 'name domain')
        .populate(
          'items.productId',
          'name price deliveryFee imageUrl productLink description sellerNotes'
        )
        .populate('courier', 'name');

      return {
        orders,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding orders:', error);
      throw error;
    }
  }

  /**
   * Find a single order by ID
   * @param {string} id - Order ID (MongoDB _id)
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Order object
   */
  async findOrderById(id, user = {}) {
    const order = await Order.findById(id)
      .populate('assignedOperatorId', 'name email')
      .populate('callHistory.operatorId', 'name firstName lastName email')
      .populate('shopId', 'name domain')
      .populate(
        'items.productId',
        'name price deliveryFee imageUrl productLink description sellerNotes'
      );

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    // Check shop ownership for non-admin users
    if (user.role !== 'admin' && user.shopId) {
      const orderShopId = order.shopId?._id || order.shopId;
      if (orderShopId && orderShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }
    }

    const phone = order.clientInfo?.phone;

    let customerHistory = null;

    if (phone) {
      const customerQuery = {
        'clientInfo.phone': phone
      };

      const [
        totalOrders,
        successfulDeliveries,
        failedDeliveries,
        rejectedOrders,
        cancelledOrders,
        noAnswerOrders,
        firstOrder,
        lastOrder
      ] = await Promise.all([
        Order.countDocuments(customerQuery),

        Order.countDocuments({
          ...customerQuery,
          status: 'delivered'
        }),

        Order.countDocuments({
          ...customerQuery,
          status: 'failed_delivery'
        }),

        Order.countDocuments({
          ...customerQuery,
          status: 'rejected'
        }),

        Order.countDocuments({
          ...customerQuery,
          status: 'cancelled'
        }),

        Order.countDocuments({
          ...customerQuery,
          callHistory: {
            $elemMatch: { result: 'no_answer' }
          }
        }),

        Order.findOne(customerQuery)
          .sort({ createdAt: 1 })
          .select('createdAt')
          .lean(),

        Order.findOne(customerQuery)
          .sort({ createdAt: -1 })
          .select('createdAt')
          .lean()
      ]);

      const completedDeliveries =
        successfulDeliveries + failedDeliveries;

      const successRate =
        completedDeliveries > 0
          ? Math.round(
              (successfulDeliveries / completedDeliveries) * 100
            )
          : null;

      customerHistory = {
        totalOrders,
        successfulDeliveries,
        failedDeliveries,
        rejectedOrders,
        cancelledOrders,
        noAnswerOrders,
        successRate,
        isNewCustomer: totalOrders <= 1,
        isRepeatCustomer: totalOrders > 1,
        customerSince: firstOrder?.createdAt || null,
        lastOrderAt: lastOrder?.createdAt || null,

        // No reliable deliveredAt field exists yet.
        lastDeliveryAt: null
      };
    }

    const customerFindings = [];

    if (customerHistory) {
      if (customerHistory.isNewCustomer) {
        customerFindings.push({
          key: 'customer_new',
          level: 'neutral',
          description:
            'Nouveau client — historique CONFIRMED encore limité.',
          impact: 'neutral'
        });
      } else {
        customerFindings.push({
          key: 'customer_known',
          level: 'positive',
          description:
            `Client connu de CONFIRMED avec ${customerHistory.totalOrders} commandes enregistrées.`,
          impact: 'positive'
        });
      }

      if (customerHistory.successfulDeliveries >= 2) {
        customerFindings.push({
          key: 'customer_multiple_successful_deliveries',
          level: 'positive',
          description:
            `${customerHistory.successfulDeliveries} livraisons réussies enregistrées pour ce client.`,
          impact: 'positive'
        });
      }

      if (customerHistory.failedDeliveries >= 2) {
        customerFindings.push({
          key: 'customer_multiple_failed_deliveries',
          level: 'alert',
          description:
            `${customerHistory.failedDeliveries} échecs de livraison enregistrés pour ce client.`,
          impact: 'negative'
        });
      }

      if (customerHistory.rejectedOrders >= 2) {
        customerFindings.push({
          key: 'customer_multiple_rejections',
          level: 'alert',
          description:
            `${customerHistory.rejectedOrders} commandes refusées dans l’historique du client.`,
          impact: 'negative'
        });
      }

      if (customerHistory.cancelledOrders >= 2) {
        customerFindings.push({
          key: 'customer_multiple_cancellations',
          level: 'alert',
          description:
            `${customerHistory.cancelledOrders} annulations enregistrées dans l’historique du client.`,
          impact: 'negative'
        });
      }

      if (customerHistory.noAnswerOrders >= 2) {
        customerFindings.push({
          key: 'customer_frequently_unreachable',
          level: 'alert',
          description:
            `Client fréquemment injoignable : ${customerHistory.noAnswerOrders} commandes avec au moins un appel sans réponse.`,
          impact: 'negative'
        });
      }

      if (
        customerHistory.isRepeatCustomer &&
        customerHistory.successfulDeliveries === 0 &&
        customerHistory.failedDeliveries === 0
      ) {
        customerFindings.push({
          key: 'customer_delivery_history_limited',
          level: 'neutral',
          description:
            'Client récurrent, mais historique de livraison encore insuffisant.',
          impact: 'neutral'
        });
      }
    }

    // Historical order-value statistics used to compare the current
    // order with the merchant average and the customer's own habits.
    const orderShopId = order.shopId?._id || order.shopId;

    const baseValueQuery = {
      _id: { $ne: order._id }
    };

    if (orderShopId) {
      baseValueQuery.shopId = orderShopId;
    }

    const customerValueQuery = {
      ...baseValueQuery,
      'clientInfo.phone': phone
    };

    const [shopValueStats, customerValueStats] = await Promise.all([
      Order.aggregate([
        { $match: baseValueQuery },
        {
          $group: {
            _id: null,
            orderCount: { $sum: 1 },
            averageOrderValue: { $avg: '$totalAmount' }
          }
        }
      ]),

      phone
        ? Order.aggregate([
            { $match: customerValueQuery },
            {
              $group: {
                _id: null,
                orderCount: { $sum: 1 },
                averageOrderValue: { $avg: '$totalAmount' }
              }
            }
          ])
        : Promise.resolve([])
    ]);

    const shopStats = shopValueStats[0] || null;
    const customerStats = customerValueStats[0] || null;

    const shopAverageOrderValue =
      shopStats?.averageOrderValue != null
        ? Number(shopStats.averageOrderValue.toFixed(2))
        : null;

    const customerAverageOrderValue =
      customerStats?.averageOrderValue != null
        ? Number(customerStats.averageOrderValue.toFixed(2))
        : null;

    const differenceFromShopAverage =
      shopAverageOrderValue && shopAverageOrderValue > 0
        ? Number(
            (
              ((order.totalAmount - shopAverageOrderValue) /
                shopAverageOrderValue) *
              100
            ).toFixed(1)
          )
        : null;

    const differenceFromCustomerAverage =
      customerAverageOrderValue && customerAverageOrderValue > 0
        ? Number(
            (
              ((order.totalAmount - customerAverageOrderValue) /
                customerAverageOrderValue) *
              100
            ).toFixed(1)
          )
        : null;

    const orderValueStats = {
      currentAmount: order.totalAmount,
      shopHistoricalOrderCount: shopStats?.orderCount || 0,
      shopAverageOrderValue,
      differenceFromShopAverage,
      customerHistoricalOrderCount: customerStats?.orderCount || 0,
      customerAverageOrderValue,
      differenceFromCustomerAverage
    };

    const orderValueFindings = [];

    // Reuse the same amount rules already used by the AI scoring engine.
    if (order.totalAmount >= 50 && order.totalAmount <= 300) {
      orderValueFindings.push({
        key: 'order_value_low_moderate',
        level: 'positive',
        description:
          `Valeur de commande faible à modérée : ${order.totalAmount} DT.`,
        impact: 'positive'
      });
    } else if (order.totalAmount < 10) {
      orderValueFindings.push({
        key: 'order_value_very_low',
        level: 'alert',
        description:
          `Montant inhabituellement faible : ${order.totalAmount} DT.`,
        impact: 'negative'
      });
    } else if (order.totalAmount > 1000) {
      orderValueFindings.push({
        key: 'order_value_high',
        level: 'alert',
        description:
          `Commande à forte valeur : ${order.totalAmount} DT.`,
        impact: 'negative'
      });
    } else {
      orderValueFindings.push({
        key: 'order_value_neutral',
        level: 'neutral',
        description:
          `Montant nécessitant une attention particulière : ${order.totalAmount} DT.`,
        impact: 'neutral'
      });
    }

    if (
      orderValueStats.shopAverageOrderValue !== null &&
      orderValueStats.shopHistoricalOrderCount > 0
    ) {
      orderValueFindings.push({
        key: 'order_value_shop_comparison',
        level: 'neutral',
        description:
          `Panier moyen historique de la boutique : ${orderValueStats.shopAverageOrderValue} DT. Écart de cette commande : ${orderValueStats.differenceFromShopAverage} %.`,
        impact: 'neutral'
      });
    }

    if (orderValueStats.customerHistoricalOrderCount === 0) {
      orderValueFindings.push({
        key: 'order_value_customer_history_insufficient',
        level: 'neutral',
        description:
          'Aucun historique client disponible pour comparer ce montant à ses habitudes d’achat.',
        impact: 'neutral'
      });
    } else if (orderValueStats.customerAverageOrderValue !== null) {
      orderValueFindings.push({
        key: 'order_value_customer_comparison',
        level: 'neutral',
        description:
          `Panier moyen historique du client : ${orderValueStats.customerAverageOrderValue} DT. Écart actuel : ${orderValueStats.differenceFromCustomerAverage} %.`,
        impact: 'neutral'
      });
    }

    // Historical ordering-hour statistics for the merchant.
    // Raw statistics only: findings are generated separately.
    const orderCreatedAt = new Date(order.createdAt);
    const orderHourUTC = orderCreatedAt.getUTCHours();

    const timeMatchQuery = {
      _id: { $ne: order._id }
    };

    if (orderShopId) {
      timeMatchQuery.shopId = orderShopId;
    }

    const hourlyDistribution = await Order.aggregate([
      { $match: timeMatchQuery },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const totalHistoricalOrdersByHour = hourlyDistribution.reduce(
      (sum, item) => sum + item.orderCount,
      0
    );

    const sameHourEntry = hourlyDistribution.find(
      item => item._id === orderHourUTC
    );

    const sameHourOrderCount = sameHourEntry?.orderCount || 0;

    const sameHourShare =
      totalHistoricalOrdersByHour > 0
        ? Number(
            (
              (sameHourOrderCount / totalHistoricalOrdersByHour) *
              100
            ).toFixed(1)
          )
        : null;

    // Also inspect the immediately surrounding hours.
    // This correctly handles midnight: 23 -> 0 -> 1.
    const previousHour = (orderHourUTC + 23) % 24;
    const nextHour = (orderHourUTC + 1) % 24;

    const previousHourOrderCount =
      hourlyDistribution.find(item => item._id === previousHour)?.orderCount || 0;

    const nextHourOrderCount =
      hourlyDistribution.find(item => item._id === nextHour)?.orderCount || 0;

    const surroundingHourOrderCount =
      previousHourOrderCount +
      sameHourOrderCount +
      nextHourOrderCount;

    const surroundingHourShare =
      totalHistoricalOrdersByHour > 0
        ? Number(
            (
              (surroundingHourOrderCount / totalHistoricalOrdersByHour) *
              100
            ).toFixed(1)
          )
        : null;

    const peakHours = [...hourlyDistribution]
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 5)
      .map(item => ({
        hour: item._id,
        orderCount: item.orderCount
      }));

    const orderTimeStats = {
      createdAt: order.createdAt,
      hourUTC: orderHourUTC,
      totalHistoricalOrders: totalHistoricalOrdersByHour,
      sameHourOrderCount,
      sameHourShare,
      previousHourOrderCount,
      nextHourOrderCount,
      surroundingHourOrderCount,
      surroundingHourShare,
      peakHours
    };

    const orderTimeFindings = [];

    if (orderTimeStats.totalHistoricalOrders < 20) {
      orderTimeFindings.push({
        key: 'order_time_history_insufficient',
        level: 'neutral',
        description:
          'Historique CONFIRMED insuffisant pour évaluer les habitudes horaires de cette boutique.',
        impact: 'neutral'
      });
    } else if (orderTimeStats.sameHourOrderCount > 0) {
      orderTimeFindings.push({
        key: 'order_time_observed',
        level: 'positive',
        description:
          `Horaire déjà observé dans l’historique de la boutique : ${orderTimeStats.sameHourOrderCount} commandes exactement à cette heure.`,
        impact: 'positive'
      });
    } else if (orderTimeStats.surroundingHourOrderCount > 0) {
      orderTimeFindings.push({
        key: 'order_time_near_usual_window',
        level: 'neutral',
        description:
          `Horaire proche des habitudes observées : ${orderTimeStats.surroundingHourOrderCount} commandes historiques dans la plage d’une heure avant ou après (${orderTimeStats.surroundingHourShare} % de l’historique).`,
        impact: 'neutral'
      });
    } else {
      orderTimeFindings.push({
        key: 'order_time_unusual',
        level: 'alert',
        description:
          `Horaire atypique : aucune commande historique observée à cette heure ni dans l’heure précédente ou suivante.`,
        impact: 'negative'
      });
    }

    // CONFIRMED historical statistics for the order's geographical zone.
    // Aggregate statistics only: no customer or merchant details are exposed.
    const regionName = (
      order.region ||
      order.clientInfo?.address?.state ||
      order.clientInfo?.address?.city ||
      ''
    ).trim();

    let regionStats = null;

    if (regionName) {
      const escapedRegion = regionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regionRegex = new RegExp(`^${escapedRegion}$`, 'i');

      const regionQuery = {
        $or: [
          { region: regionRegex },
          { 'clientInfo.address.state': regionRegex },
          { 'clientInfo.address.city': regionRegex }
        ]
      };

      const [
        totalOrdersInRegion,
        deliveredOrders,
        failedDeliveries,
        rejectedOrders,
        cancelledOrders
      ] = await Promise.all([
        Order.countDocuments(regionQuery),

        Order.countDocuments({
          ...regionQuery,
          status: 'delivered'
        }),

        Order.countDocuments({
          ...regionQuery,
          status: 'failed_delivery'
        }),

        Order.countDocuments({
          ...regionQuery,
          status: 'rejected'
        }),

        Order.countDocuments({
          ...regionQuery,
          status: 'cancelled'
        })
      ]);

      const completedDeliveries =
        deliveredOrders + failedDeliveries;

      const deliverySuccessRate =
        completedDeliveries > 0
          ? Math.round(
              (deliveredOrders / completedDeliveries) * 100
            )
          : null;

      const failureRate =
        completedDeliveries > 0
          ? Math.round(
              (failedDeliveries / completedDeliveries) * 100
            )
          : null;

      const refusalRate =
        totalOrdersInRegion > 0
          ? Math.round(
              (rejectedOrders / totalOrdersInRegion) * 100
            )
          : null;

      const cancellationRate =
        totalOrdersInRegion > 0
          ? Math.round(
              (cancelledOrders / totalOrdersInRegion) * 100
            )
          : null;

      regionStats = {
        region: regionName,
        totalOrders: totalOrdersInRegion,
        deliveredOrders,
        failedDeliveries,
        rejectedOrders,
        cancelledOrders,
        deliverySuccessRate,
        failureRate,
        refusalRate,
        cancellationRate
      };
    }

    const regionFindings = [];

    if (regionStats) {
      const completedDeliveries =
        regionStats.deliveredOrders + regionStats.failedDeliveries;

      if (completedDeliveries === 0) {
        regionFindings.push({
          key: 'region_history_insufficient',
          level: 'neutral',
          description:
            `Historique CONFIRMED insuffisant pour évaluer la zone ${regionStats.region}.`,
          impact: 'neutral'
        });
      }
    }

    const aiSummary =
      typeof order.aiScore === 'number'
        ? aiScoringService.generateSummary(order)
        : null;

    const addressFindings =
      typeof order.aiScore === 'number'
        ? aiScoringService.generateAddressFindings(order)
        : [];

    return {
      ...order.toObject(),
      customerHistory,
      customerFindings,
      orderValueStats,
      orderValueFindings,
      orderTimeStats,
      orderTimeFindings,
      regionStats,
      regionFindings,
      aiSummary,
      addressFindings
    };
  }


  /**
   * Confirmer une commande après saisie du
   * Retour opérateur structuré.
   *
   * Cette méthode ne passe PAS par updateOrderStatus().
   */
  async confirmByOperator(
    id,
    feedback = {},
    user = {}
  ) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error(
        'Commande introuvable.'
      );
      error.statusCode = 404;
      throw error;
    }

    const operatorId =
      user._id || user.id;

    if (!operatorId) {
      const error = new Error(
        'Opérateur invalide.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Vérification boutique.
     */
    const orderShopId =
      order.shopId?._id || order.shopId;

    const userShopId =
      user.shopId?._id || user.shopId;

    if (
      orderShopId &&
      userShopId &&
      String(orderShopId) !==
        String(userShopId)
    ) {
      const error = new Error(
        'Accès refusé à cette commande.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Une commande déjà finalisée ne peut pas être
     * confirmée une deuxième fois.
     */
    const allowedStatuses = [
      'pending',
      'assigned',
      'in_progress'
    ];

    if (
      !allowedStatuses.includes(
        order.status
      )
    ) {
      const error = new Error(
        'Cette commande ne peut plus être confirmée.'
      );
      error.statusCode = 409;
      throw error;
    }

    const assignedOperatorId =
      order.assignedOperatorId
        ? String(order.assignedOperatorId)
        : null;

    if (
      assignedOperatorId &&
      assignedOperatorId !==
        String(operatorId)
    ) {
      const error = new Error(
        'Cette commande est attribuée à un autre opérateur.'
      );
      error.statusCode = 403;
      throw error;
    }

    if (!order.assignedOperatorId) {
      order.assignedOperatorId =
        operatorId;
    }

    const now = new Date();

    const callDuration =
      Number.isFinite(feedback.duration) &&
      feedback.duration > 0
        ? Math.round(feedback.duration)
        : undefined;

    /*
     * Compatibilité avec les analytics historiques.
     *
     * Ce mapping n'est PAS une pondération du Score IA.
     */
    const confidenceCompatibility = {
      very_firm: 'strong',
      normal: 'neutral',
      weak: 'doubtful'
    };

    const structuredFeedback = {
      toneSignals:
        Array.isArray(feedback.toneSignals)
          ? feedback.toneSignals
          : [],

      confirmationLevel:
        feedback.confirmationLevel,

      priceBehavior:
        feedback.priceBehavior,

      productDoubts:
        feedback.productDoubts,

      deliveryInformation:
        feedback.deliveryInformation,

      engagementLevel:
        feedback.engagementLevel,

      receptionIntent:
        feedback.receptionIntent,

      notes:
        typeof feedback.notes === 'string'
          ? feedback.notes.trim()
          : ''
    };

    order.operatorFeedback = {
      confidence:
        confidenceCompatibility[
          feedback.confirmationLevel
        ],

      ...structuredFeedback,

      operatorId,
      submittedAt: now
    };

    /*
     * Snapshot complet dans l'historique d'appel.
     */
    order.callHistory.push({
      operatorId,
      callType: 'human',
      timestamp: now,
      duration: callDuration,
      result: 'confirmed',
      notes: structuredFeedback.notes,
      feedback: structuredFeedback
    });

    order.status = 'confirmed';
    order.confirmedAt = now;
    order.confirmedByOperatorId =
      operatorId;

    order.statusHistory.push({
      status: 'confirmed',
      timestamp: now,
      operatorId,
      source: 'operator',
      reason:
        'Commande confirmée avec retour opérateur',
      notes:
        structuredFeedback.notes || undefined
    });

    /*
     * Le PDF demande un recalcul du Score IA après
     * récupération du Retour opérateur.
     *
     * Le moteur actuel ne définit encore aucune
     * pondération comportementale : on déclenche donc
     * son recalcul existant sans inventer de coefficients.
     */
    aiScoringService.enrichOrder(order);

    await order.save();

    await order.populate(
      'assignedOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'operatorFeedback.operatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'confirmedByOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'callHistory.operatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'statusHistory.operatorId',
      'name firstName lastName email'
    );

    emitOrderUpdate(order);

    await logActivity(
      'order',
      'Commande confirmée',
      `#${order.confirmedId || order.orderId}`
    );

    return order;
  }


  /**
   * Reporter une commande à une date ultérieure.
   *
   * La date est obligatoire.
   * L'heure et la note sont facultatives.
   */
  async postponeByOperator(
    id,
    data = {},
    user = {}
  ) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error(
        'Commande introuvable.'
      );
      error.statusCode = 404;
      throw error;
    }

    const operatorId =
      user._id || user.id;

    if (!operatorId) {
      const error = new Error(
        'Opérateur invalide.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Vérification boutique.
     */
    const orderShopId =
      order.shopId?._id || order.shopId;

    const userShopId =
      user.shopId?._id || user.shopId;

    if (
      orderShopId &&
      userShopId &&
      String(orderShopId) !==
        String(userShopId)
    ) {
      const error = new Error(
        'Accès refusé à cette commande.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Autoriser également postponed afin qu'une
     * commande déjà reportée puisse être replanifiée.
     */
    const allowedStatuses = [
      'pending',
      'assigned',
      'in_progress',
      'postponed'
    ];

    if (
      !allowedStatuses.includes(
        order.status
      )
    ) {
      const error = new Error(
        'Cette commande ne peut plus être reportée.'
      );
      error.statusCode = 409;
      throw error;
    }

    const assignedOperatorId =
      order.assignedOperatorId
        ? String(order.assignedOperatorId)
        : null;

    if (
      assignedOperatorId &&
      assignedOperatorId !==
        String(operatorId)
    ) {
      const error = new Error(
        'Cette commande est attribuée à un autre opérateur.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Construire scheduledFor en UTC à partir
     * de la date/heure locale du navigateur.
     */
    const [year, month, day] =
      data.date
        .split('-')
        .map(Number);

    const calendarCheck =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );

    if (
      calendarCheck.getUTCFullYear() !== year ||
      calendarCheck.getUTCMonth() !== month - 1 ||
      calendarCheck.getUTCDate() !== day
    ) {
      const error = new Error(
        'Date de report invalide.'
      );
      error.statusCode = 422;
      throw error;
    }

    let hour = 0;
    let minute = 0;

    if (data.time) {
      [hour, minute] =
        data.time
          .split(':')
          .map(Number);
    }

    /*
     * getTimezoneOffset() = UTC - heure locale.
     * UTC = heure locale + offset.
     */
    const scheduledTimestamp =
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        0,
        0
      ) +
      data.timezoneOffsetMinutes *
        60 *
        1000;

    const scheduledFor =
      new Date(scheduledTimestamp);

    if (
      Number.isNaN(
        scheduledFor.getTime()
      )
    ) {
      const error = new Error(
        'Date de report invalide.'
      );
      error.statusCode = 422;
      throw error;
    }

    if (
      scheduledFor.getTime() <=
      Date.now()
    ) {
      const error = new Error(
        'La date de report doit être dans le futur.'
      );
      error.statusCode = 422;
      throw error;
    }

    const now = new Date();

    if (!order.assignedOperatorId) {
      order.assignedOperatorId =
        operatorId;
    }

    order.status =
      'postponed';

    order.postponement = {
      date: data.date,
      time: data.time || '',
      scheduledFor,
      note:
        typeof data.note === 'string'
          ? data.note.trim()
          : '',
      postponedAt: now,
      postponedByOperatorId:
        operatorId
    };

    /*
     * Conserver une trace métier.
     * Aucun callHistory n'est créé ici.
     */
    order.statusHistory.push({
      status: 'postponed',
      timestamp: now,
      operatorId,
      source: 'operator',
      reason: 'Commande reportée',
      notes:
        typeof data.note === 'string'
          ? data.note.trim()
          : undefined
    });

    await order.save();

    await order.populate(
      'assignedOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'postponement.postponedByOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'statusHistory.operatorId',
      'name firstName lastName email'
    );

    emitOrderUpdate(order);

    await logActivity(
      'order',
      'Commande reportée',
      `#${order.confirmedId || order.orderId}`
    );

    return order;
  }


  /**
   * Annulation manuelle d'une commande par l'opérateur.
   *
   * Le motif et le commentaire sont facultatifs.
   * Cette méthode ne passe PAS par updateOrderStatus().
   */
  async cancelByOperator(
    id,
    data = {},
    user = {}
  ) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error(
        'Commande introuvable.'
      );
      error.statusCode = 404;
      throw error;
    }

    const operatorId =
      user._id || user.id;

    if (!operatorId) {
      const error = new Error(
        'Opérateur invalide.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Vérifier que la commande appartient bien
     * à la boutique de l'opérateur.
     */
    const orderShopId =
      order.shopId?._id || order.shopId;

    const userShopId =
      user.shopId?._id || user.shopId;

    if (
      orderShopId &&
      userShopId &&
      String(orderShopId) !==
        String(userShopId)
    ) {
      const error = new Error(
        'Accès refusé à cette commande.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Une commande déjà finalisée ne doit plus
     * être annulée depuis l'espace opérateur.
     */
    const allowedStatuses = [
      'pending',
      'assigned',
      'in_progress',
      'postponed'
    ];

    if (
      !allowedStatuses.includes(
        order.status
      )
    ) {
      const error = new Error(
        'Cette commande ne peut plus être annulée.'
      );
      error.statusCode = 409;
      throw error;
    }

    /*
     * Une commande déjà attribuée à un autre
     * opérateur ne peut pas être modifiée.
     */
    const assignedOperatorId =
      order.assignedOperatorId
        ? String(order.assignedOperatorId)
        : null;

    if (
      assignedOperatorId &&
      assignedOperatorId !==
        String(operatorId)
    ) {
      const error = new Error(
        'Cette commande est attribuée à un autre opérateur.'
      );
      error.statusCode = 403;
      throw error;
    }

    const now = new Date();

    const reason =
      data.reason || undefined;

    const comment =
      typeof data.comment === 'string'
        ? data.comment.trim()
        : '';

    /*
     * Si la commande était libre, enregistrer
     * l'opérateur qui a effectué l'action.
     */
    if (!order.assignedOperatorId) {
      order.assignedOperatorId =
        operatorId;
    }

    order.status = 'cancelled';

    order.cancellationReason =
      reason;

    order.cancellationReasonDetails =
      comment || undefined;

    order.cancelledBy =
      'operator';

    order.cancelledAt =
      now;

    order.cancelledByOperatorId =
      operatorId;

    /*
     * Historique métier séparé du callHistory.
     * Une annulation n'est pas une tentative d'appel.
     */
    order.statusHistory.push({
      status: 'cancelled',
      timestamp: now,
      operatorId,
      source: 'operator',
      reason,
      notes: comment || undefined
    });

    await order.save();

    await order.populate(
      'assignedOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'cancelledByOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'statusHistory.operatorId',
      'name firstName lastName email'
    );

    emitOrderUpdate(order);

    await logActivity(
      'order',
      'Commande annulée',
      `#${order.confirmedId || order.orderId}`
    );

    return order;
  }


  /**
   * Enregistrer une tentative de contact opérateur.
   *
   * Une tentative n'est PAS un statut Order.
   */
  async recordCallAttempt(id, data = {}, user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error(
        'Commande introuvable.'
      );
      error.statusCode = 404;
      throw error;
    }

    const operatorId = user._id || user.id;

    if (!operatorId) {
      const error = new Error(
        'Opérateur invalide.'
      );
      error.statusCode = 403;
      throw error;
    }

    const allowedStatuses = [
      'pending',
      'assigned',
      'in_progress'
    ];

    if (!allowedStatuses.includes(order.status)) {
      const error = new Error(
        'Cette commande ne peut plus recevoir de tentative d’appel.'
      );
      error.statusCode = 409;
      throw error;
    }

    const assignedOperatorId =
      order.assignedOperatorId
        ? String(order.assignedOperatorId)
        : null;

    if (
      assignedOperatorId &&
      assignedOperatorId !== String(operatorId)
    ) {
      const error = new Error(
        'Cette commande est attribuée à un autre opérateur.'
      );
      error.statusCode = 403;
      throw error;
    }

    if (!assignedOperatorId) {
      order.assignedOperatorId = operatorId;
    }

    /*
     * Compter uniquement les vraies tentatives
     * enregistrées par l'opérateur.
     */
    const previousAttempts =
      (order.callHistory || []).filter(entry =>
        entry.callType === 'human' &&
        [1, 2, 3].includes(entry.attemptNumber)
      );

    const expectedAttempt =
      previousAttempts.length + 1;

    if (data.attemptNumber !== expectedAttempt) {
      const error = new Error(
        `La prochaine tentative doit être la tentative ${expectedAttempt}.`
      );
      error.statusCode = 422;
      throw error;
    }

    if (expectedAttempt > 3) {
      const error = new Error(
        'Les trois tentatives ont déjà été enregistrées.'
      );
      error.statusCode = 409;
      throw error;
    }

    const reason =
      data.reason || undefined;

    const callEntry = {
      operatorId,
      callType: 'human',
      timestamp: new Date(),
      duration: data.duration,
      attemptNumber: data.attemptNumber,
      notes: data.notes || ''
    };

    /*
     * Le motif est réellement optionnel.
     * Ne pas transformer l'absence de motif en "other".
     */
    if (reason) {
      callEntry.result = reason;
      callEntry.attemptReason = reason;
    }

    order.callHistory.push(callEntry);

    /*
     * Une tentative n'est PAS un statut.
     *
     * Si la commande était libre, elle devient simplement
     * attribuée à l'opérateur. Sinon son statut actuel est
     * conservé.
     *
     * T1 et T2 restent donc visibles dans la File d'attente.
     */
    if (order.status === 'pending') {
      order.status = 'assigned';
    }

    await order.save();

    await order.populate(
      'callHistory.operatorId',
      'name firstName lastName email'
    );

    emitOrderUpdate(order);

    await logActivity(
      'order',
      'Tentative d’appel enregistrée',
      `Tentative ${data.attemptNumber} effectuée sur la commande #${order.confirmedId || order.orderId}`
    );

    return {
      order,
      attemptNumber: data.attemptNumber,

      // Après T3, le frontend devra demander confirmation.
      requiresCancellationConfirmation:
        data.attemptNumber === 3
    };
  }


  /**
   * Confirmer l'annulation après trois tentatives
   * infructueuses.
   *
   * Cette méthode est volontairement séparée de
   * updateOrderStatus() afin de préserver correctement
   * l'historique métier.
   */
  async confirmUnreachableCancellation(
    id,
    user = {}
  ) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error(
        'Commande introuvable.'
      );
      error.statusCode = 404;
      throw error;
    }

    const operatorId =
      user._id || user.id;

    if (!operatorId) {
      const error = new Error(
        'Opérateur invalide.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * Double clic / double requête :
     * rendre l'action idempotente si cette annulation
     * précise a déjà été effectuée.
     */
    if (
      order.status === 'cancelled' &&
      order.cancellationReason ===
        'unreachable_after_3_attempts'
    ) {
      return order;
    }

    const allowedStatuses = [
      'pending',
      'assigned',
      'in_progress'
    ];

    if (!allowedStatuses.includes(order.status)) {
      const error = new Error(
        'Cette commande ne peut pas être annulée depuis la File d’attente.'
      );
      error.statusCode = 409;
      throw error;
    }

    const assignedOperatorId =
      order.assignedOperatorId
        ? String(order.assignedOperatorId)
        : null;

    if (
      assignedOperatorId &&
      assignedOperatorId !== String(operatorId)
    ) {
      const error = new Error(
        'Cette commande est attribuée à un autre opérateur.'
      );
      error.statusCode = 403;
      throw error;
    }

    /*
     * L'annulation automatique n'est autorisée
     * qu'après T1 + T2 + T3 réellement enregistrées.
     */
    const attemptNumbers =
      [
        ...new Set(
          (order.callHistory || [])
            .filter(entry =>
              entry.callType === 'human' &&
              [1, 2, 3].includes(
                entry.attemptNumber
              )
            )
            .map(entry => entry.attemptNumber)
        )
      ].sort();

    const hasThreeAttempts =
      attemptNumbers.length === 3 &&
      attemptNumbers[0] === 1 &&
      attemptNumbers[1] === 2 &&
      attemptNumbers[2] === 3;

    if (!hasThreeAttempts) {
      const error = new Error(
        'Trois tentatives doivent être enregistrées avant cette annulation.'
      );
      error.statusCode = 409;
      throw error;
    }

    const now = new Date();

    order.status = 'cancelled';

    order.cancellationReason =
      'unreachable_after_3_attempts';

    order.cancellationReasonDetails =
      'Client injoignable après 3 tentatives';

    order.cancelledBy = 'operator';
    order.cancelledAt = now;
    order.cancelledByOperatorId =
      operatorId;

    order.statusHistory.push({
      status: 'cancelled',
      timestamp: now,
      operatorId,
      source: 'operator',
      reason:
        'Client injoignable après 3 tentatives'
    });

    await order.save();

    await order.populate(
      'assignedOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'cancelledByOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'callHistory.operatorId',
      'name firstName lastName email'
    );

    emitOrderUpdate(order);

    await logActivity(
      'order',
      'Commande annulée après 3 tentatives',
      `#${order.confirmedId || order.orderId}`
    );

    return order;
  }


  /**
   * Modifier les informations nécessaires à l'opérateur
   * pendant un appel.
   *
   * Le catalogue Product n'est jamais modifié ici.
   * Les prix/quantités modifiés appartiennent uniquement
   * à la commande.
   *
   * @param {string} id
   * @param {Object} data
   * @param {Object} user
   * @returns {Promise<Object>}
   */
  async updateOperatorDetails(id, data = {}, user = {}) {
    const Product = require('../models/Product');

    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Commande introuvable.');
      error.statusCode = 404;
      throw error;
    }

    const userId = user._id || user.id;

    if (!userId) {
      const error = new Error('Utilisateur opérateur invalide.');
      error.statusCode = 403;
      throw error;
    }

    /*
     * Une commande déjà finalisée ou expédiée ne doit pas
     * être modifiée depuis la File d'attente.
     */
    const editableStatuses = [
      'pending',
      'assigned',
      'in_progress',
      'postponed'
    ];

    if (!editableStatuses.includes(order.status)) {
      const error = new Error(
        'Cette commande ne peut plus être modifiée depuis la File d’attente.'
      );
      error.statusCode = 409;
      throw error;
    }

    /*
     * Contrôle d'accès opérateur.
     *
     * - un opérateur ne peut pas modifier la commande
     *   attribuée à un autre opérateur ;
     * - une commande non attribuée peut être prise en charge
     *   uniquement si elle appartient à sa boutique.
     */
    if (user.role === 'operator') {
      const assignedOperatorId = order.assignedOperatorId
        ? String(order.assignedOperatorId)
        : null;

      const orderShopId = order.shopId
        ? String(order.shopId)
        : null;

      const userShopId = user.shopId
        ? String(user.shopId)
        : null;

      const assignedToCurrentOperator =
        assignedOperatorId === String(userId);

      const assignedToAnotherOperator =
        assignedOperatorId &&
        assignedOperatorId !== String(userId);

      const sameShop =
        userShopId &&
        orderShopId &&
        userShopId === orderShopId;

      if (assignedToAnotherOperator) {
        const error = new Error(
          'Cette commande est déjà attribuée à un autre opérateur.'
        );
        error.statusCode = 403;
        throw error;
      }

      if (!assignedToCurrentOperator && !sameShop) {
        const error = new Error(
          'Vous n’avez pas accès à cette commande.'
        );
        error.statusCode = 403;
        throw error;
      }

      /*
       * Première modification d'une commande encore libre :
       * elle est automatiquement attribuée à l'opérateur.
       */
      if (!assignedOperatorId) {
        order.assignedOperatorId = userId;

        if (order.status === 'pending') {
          order.status = 'assigned';
        }
      }
    }


    // =====================================================
    // CLIENT
    // =====================================================

    if (data.clientInfo) {
      const client = data.clientInfo;

      if (client.name !== undefined) {
        order.clientInfo.name = client.name.trim();
      }

      if (client.phone !== undefined) {
        order.clientInfo.phone = client.phone.trim();
      }

      if (client.additionalPhones !== undefined) {
        const primaryPhone = String(
          client.phone !== undefined
            ? client.phone
            : order.clientInfo.phone || ''
        ).trim();

        /*
         * Nettoyage :
         * - supprimer valeurs vides
         * - supprimer doublons
         * - ne pas répéter le téléphone principal
         */
        const normalizedPhones = [
          ...new Set(
            client.additionalPhones
              .map(phone => String(phone || '').trim())
              .filter(Boolean)
          )
        ].filter(phone => phone !== primaryPhone);

        order.clientInfo.additionalPhones = normalizedPhones;
      } else if (client.phone !== undefined) {
        /*
         * Si seul le principal change, empêcher qu'il reste
         * également dans additionalPhones.
         */
        const currentAdditional =
          order.clientInfo.additionalPhones || [];

        order.clientInfo.additionalPhones =
          currentAdditional.filter(
            phone =>
              String(phone).trim() !==
              String(order.clientInfo.phone).trim()
          );
      }

      if (client.address) {
        if (!order.clientInfo.address) {
          order.clientInfo.address = {};
        }

        const addressFields = [
          'street',
          'city',
          'state',
          'district',
          'zipCode',
          'country'
        ];

        for (const field of addressFields) {
          if (client.address[field] !== undefined) {
            order.clientInfo.address[field] =
              client.address[field];
          }
        }

        /*
         * region existe encore dans certaines parties
         * historiques de CONFIRMED.
         * On le garde synchronisé avec le gouvernorat.
         */
        if (client.address.state !== undefined) {
          order.region = client.address.state;
        }
      }
    }


    // =====================================================
    // PRODUITS / QUANTITE / PRIX
    // =====================================================

    if (data.items !== undefined) {
      for (const incomingItem of data.items) {
        const item = order.items.id(incomingItem._id);

        if (!item) {
          const error = new Error(
            `Article de commande introuvable : ${incomingItem._id}`
          );
          error.statusCode = 422;
          throw error;
        }

        /*
         * Changement de produit.
         * Le produit doit appartenir à la même boutique.
         */
        if (
          incomingItem.productId !== undefined &&
          incomingItem.productId !== null &&
          incomingItem.productId !== ''
        ) {
          const product = await Product.findOne({
            _id: incomingItem.productId,
            shopId: order.shopId,
            isActive: true
          });

          if (!product) {
            const error = new Error(
              'Produit introuvable ou inaccessible pour cette boutique.'
            );
            error.statusCode = 422;
            throw error;
          }

          item.productId = product._id;
          item.name = product.name;

          /*
           * Si aucun prix spécifique n'a été saisi,
           * utiliser le prix catalogue du nouveau produit.
           */
          if (incomingItem.price === undefined) {
            item.price = product.price;
          }
        }

        /*
         * Les anciennes commandes/imports peuvent
         * ne pas être reliées à un Product.
         */
        if (
          incomingItem.name !== undefined &&
          (
            incomingItem.productId === undefined ||
            incomingItem.productId === null ||
            incomingItem.productId === ''
          )
        ) {
          item.name = incomingItem.name.trim();
        }

        if (incomingItem.quantity !== undefined) {
          item.quantity = incomingItem.quantity;
        }

        if (incomingItem.price !== undefined) {
          item.price = incomingItem.price;
        }
      }
    }


    // =====================================================
    // FRAIS DE LIVRAISON
    // =====================================================

    if (data.deliveryFee !== undefined) {
      order.deliveryFee = data.deliveryFee;
    }


    // =====================================================
    // RECALCUL TOTAL SECURISE
    // =====================================================

    const itemsSubtotal = order.items.reduce(
      (sum, item) => {
        const quantity =
          Number.isFinite(Number(item.quantity))
            ? Number(item.quantity)
            : 1;

        const price =
          Number.isFinite(Number(item.price))
            ? Number(item.price)
            : 0;

        return sum + quantity * price;
      },
      0
    );

    const deliveryFee =
      Number.isFinite(Number(order.deliveryFee))
        ? Number(order.deliveryFee)
        : 0;

    /*
     * TND peut être représenté avec 3 décimales.
     */
    order.totalAmount = Number(
      (itemsSubtotal + deliveryFee).toFixed(3)
    );

    await order.save();

    /*
     * Retourner immédiatement une fiche exploitable par
     * le futur espace de travail opérateur.
     */
    await order.populate(
      'assignedOperatorId',
      'name firstName lastName email'
    );

    await order.populate(
      'shopId',
      'name domain'
    );

    await order.populate(
      'items.productId',
      'name price deliveryFee imageUrl productLink description sellerNotes'
    );

    emitOrderUpdate(order);

    await logActivity(
      'order',
      'Commande mise à jour par opérateur',
      `#${order.confirmedId || order.orderId}`
    );

    return order;
  }


  /**
   * Update order status and add call history entry
   * Emits order:updated WebSocket event on success
   * **Validates: Requirements 3.1, 3.2, 11.1**
   * 
   * @param {string} id - Order ID
   * @param {string} status - New status
   * @param {string} notes - Optional notes
   * @param {Object} user - Current user (operator)
   * @returns {Promise<Object>} Updated order
   */
  async updateOrderStatus(id, status, notes = '', user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    // Update status
    order.status = status;

    // Add call history entry
    order.callHistory.push({
      operatorId: user._id || user.id,
      callType: 'human',
      timestamp: new Date(),
      result: status === 'confirmed' ? 'confirmed' : 
              status === 'cancelled' ? 'rejected' : 'confirmed',
      notes
    });

    await order.save();

    // Emit WebSocket event for real-time updates
    emitOrderUpdate(order);

    return order;
  }

  /**
   * Assign an operator to an order
   * @param {string} id - Order ID
   * @param {string} operatorId - Operator user ID
   * @param {Object} user - Current user (must be admin)
   * @returns {Promise<Object>} Updated order
   */
  async assignOperator(id, operatorId, user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    order.assignedOperatorId = operatorId;
    await order.save();

    return order;
  }

  /**
   * Bulk update status for multiple orders
   * @param {string[]} orderIds - Array of order IDs
   * @param {string} status - New status
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Bulk operation result with successful, failed, errors
   */
  async bulkUpdateStatus(orderIds, status, user = {}) {
    const result = {
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const orderId of orderIds) {
      try {
        await this.updateOrderStatus(orderId, status, '', user);
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          orderId,
          error: error.message
        });
      }
    }

    return result;
  }

  /**
   * Delete an order
   * Emits order:delete WebSocket event on success
   * **Validates: Requirements 11.3**
   * 
   * @param {string} id - Order ID
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Deleted order
   */
  async deleteOrder(id, user = {}) {
    const order = await Order.findById(id);

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    // Check shop ownership for non-admin users
    if (user.role !== 'admin' && user.shopId) {
      const orderShopId = order.shopId?._id || order.shopId;
      if (orderShopId && orderShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }
    }

    const shopId = order.shopId;
    const orderId = order._id;

    await Order.findByIdAndDelete(id);

    // Emit WebSocket event for real-time updates
    emitOrderDelete(orderId, shopId);

    return order;
  }
}

module.exports = new OrderService();
