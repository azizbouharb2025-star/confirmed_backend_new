const express = require('express');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
const AIScoringConfig = require('../models/AIScoringConfig');
const aiScoringConfigValidator = require('../services/aiScoringConfigValidationService');
const aiScoringService = require('../services/aiScoringService');
const adminCarrierStatusRoutes = require('./adminCarrierStatus');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Dashboard analytics
router.get('/dashboard', auth, authorize('admin'), async (req, res, next) => {
  try {
    const [
      totalShops,
      totalOrders,
      totalOperators,
      activeSubscriptions,
      todayOrders,
      confirmationRate
    ] = await Promise.all([
      Shop.countDocuments({ isActive: true }),
      Order.countDocuments(),
      User.countDocuments({ role: 'operator', isActive: true }),
      Subscription.countDocuments({ status: 'active' }),
      Order.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      Order.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            confirmed: {
              $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            rate: { $multiply: [{ $divide: ['$confirmed', '$total'] }, 100] }
          }
        }
      ])
    ]);

    res.json({
      totalShops,
      totalOrders,
      totalOperators,
      activeSubscriptions,
      todayOrders,
      confirmationRate: confirmationRate[0]?.rate || 0
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/kpis
 * Admin KPI cards — frontend reads response.data directly
 */
router.get('/kpis', auth, authorize('admin'), async (req, res, next) => {
  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    const [
      totalUsers,
      thisWeekUsers,
      prevWeekUsers,
      totalOrders,
      confirmedOrders,
      cancelledOrders,
      thisWeekOrders,
      prevWeekOrders,
      thisWeekRevenue,
      prevWeekRevenue,
      activeShops,
      thisWeekShops,
      prevWeekShops
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: weekStart } }),
      User.countDocuments({ createdAt: { $gte: prevWeekStart, $lt: weekStart } }),
      Order.countDocuments(),
      Order.countDocuments({ status: 'confirmed' }),
      Order.countDocuments({ status: 'cancelled' }),
      Order.countDocuments({ createdAt: { $gte: weekStart } }),
      Order.countDocuments({ createdAt: { $gte: prevWeekStart, $lt: weekStart } }),
      Order.aggregate([
        { $match: { status: { $in: ['confirmed', 'delivered'] }, createdAt: { $gte: weekStart } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Order.aggregate([
        { $match: { status: { $in: ['confirmed', 'delivered'] }, createdAt: { $gte: prevWeekStart, $lt: weekStart } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Shop.countDocuments({ isActive: true }),
      Shop.countDocuments({ isActive: true, createdAt: { $gte: weekStart } }),
      Shop.countDocuments({ isActive: true, createdAt: { $gte: prevWeekStart, $lt: weekStart } })
    ]);

    const rev = thisWeekRevenue[0]?.total || 0;
    const prevRev = prevWeekRevenue[0]?.total || 0;

    const pct = (cur, prev) => prev > 0 ? parseFloat((((cur - prev) / prev) * 100).toFixed(1)) : 0;

    const confirmationRate = totalOrders > 0
      ? parseFloat(((confirmedOrders / totalOrders) * 100).toFixed(1))
      : 0;

    res.json({
      totalUsers,
      totalUsersChange: pct(thisWeekUsers, prevWeekUsers),
      totalOrders,
      totalOrdersChange: pct(thisWeekOrders, prevWeekOrders),
      confirmedOrders,
      cancelledOrders,
      confirmationRate,
      revenue: rev,
      revenueChange: pct(rev, prevRev),
      activeShops,
      activeShopsChange: pct(thisWeekShops, prevWeekShops)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/system-health
 * Get system health — pings DB, Redis, Queue and measures latency
 * Frontend reads: response.data.services
 */
router.get('/system-health', auth, authorize('admin'), async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const { getRedisClient } = require('../config/redis');
    const now = new Date().toISOString();
    const services = [];

    // API service (always healthy if we're responding)
    services.push({ name: 'API', status: 'healthy', latency: 0, lastCheck: now });

    // Database health
    try {
      const dbStart = Date.now();
      await mongoose.connection.db.admin().ping();
      const dbLatency = Date.now() - dbStart;
      services.push({
        name: 'Database',
        status: dbLatency > 500 ? 'degraded' : 'healthy',
        latency: dbLatency,
        lastCheck: now
      });
    } catch {
      services.push({ name: 'Database', status: 'down', latency: 0, lastCheck: now });
    }

    // Queue health (Bull uses Redis under the hood)
    try {
      const Queue = require('bull');
      const qStart = Date.now();
      const testQueue = new Queue('health-check', process.env.REDIS_URL);
      await testQueue.isReady();
      const qLatency = Date.now() - qStart;
      await testQueue.close();
      services.push({
        name: 'Queue',
        status: qLatency > 500 ? 'degraded' : 'healthy',
        latency: qLatency,
        lastCheck: now
      });
    } catch {
      services.push({ name: 'Queue', status: 'down', latency: 0, lastCheck: now });
    }

    // Cache (Redis) health
    try {
      const redis = getRedisClient();
      if (redis) {
        const cStart = Date.now();
        await redis.ping();
        const cLatency = Date.now() - cStart;
        services.push({
          name: 'Cache',
          status: cLatency > 500 ? 'degraded' : 'healthy',
          latency: cLatency,
          lastCheck: now
        });
      } else {
        services.push({ name: 'Cache', status: 'down', latency: 0, lastCheck: now });
      }
    } catch {
      services.push({ name: 'Cache', status: 'down', latency: 0, lastCheck: now });
    }

    res.json({ services });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/activity-feed
 * Frontend reads: response.data.activities
 */
router.get('/activity-feed', auth, authorize('admin'), async (req, res, next) => {
  try {
    const ActivityLog = require('../models/ActivityLog');
    const activities = await ActivityLog.find()
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    res.json({
      activities: activities.map(a => ({
        id: a._id,
        type: a.type,
        action: a.action,
        detail: a.detail,
        timestamp: a.timestamp
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/charts/orders
 * Frontend reads: response.data.data and response.data.totalOrders
 */
router.get('/charts/orders', auth, authorize('admin'), async (req, res, next) => {
  try {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Current period: last 7 days
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - 6);
    currentStart.setHours(0, 0, 0, 0);

    // Previous period: 7 days before that
    const prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 7);

    const [currentOrders, previousOrders] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: currentStart } } },
        {
          $group: {
            _id: { $dayOfWeek: '$createdAt' },
            orders: { $sum: 1 }
          }
        }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: prevStart, $lt: currentStart } } },
        {
          $group: {
            _id: { $dayOfWeek: '$createdAt' },
            orders: { $sum: 1 }
          }
        }
      ])
    ]);

    const currentMap = {};
    currentOrders.forEach(d => { currentMap[d._id] = d.orders; });
    const prevMap = {};
    previousOrders.forEach(d => { prevMap[d._id] = d.orders; });

    // Build 7-day series starting from currentStart
    const data = [];
    let totalOrders = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentStart);
      d.setDate(d.getDate() + i);
      const dow = d.getDay() + 1; // Mongo $dayOfWeek: 1=Sun
      const cur = currentMap[dow] || 0;
      const prev = prevMap[dow] || 0;
      totalOrders += cur;
      data.push({
        date: dayNames[d.getDay()],
        orders: cur,
        previousPeriod: prev
      });
    }

    res.json({ data, totalOrders });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/charts/revenue
 * Frontend reads: response.data.data and response.data.totalRevenue
 */
router.get('/charts/revenue', auth, authorize('admin'), async (req, res, next) => {
  try {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const revenueByDay = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['confirmed', 'delivered'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const revenueMap = {};
    revenueByDay.forEach(d => { revenueMap[d._id] = d.revenue; });

    const data = [];
    let cumulative = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const revenue = revenueMap[dateStr] || 0;
      cumulative += revenue;
      data.push({
        date: dayNames[d.getDay()],
        revenue,
        cumulative
      });
    }

    res.json({ data, totalRevenue: cumulative });
  } catch (error) {
    next(error);
  }
});

// Get all users
// Supports server-side search, role/status filters and pagination.
router.get('/users', auth, authorize('admin'), async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 25,
      role,
      status,
      search
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(limit, 10) || 25, 1),
      100
    );

    const conditions = [];

    if (role) {
      conditions.push({ role });
    }

    if (status === 'pending') {
      conditions.push({ accountStatus: 'pending' });
    }

    if (status === 'active') {
      conditions.push({
        $or: [
          { accountStatus: 'active', isActive: { $ne: false } },
          {
            accountStatus: { $exists: false },
            isActive: true
          }
        ]
      });
    }

    if (status === 'disabled') {
      conditions.push({
        $or: [
          { accountStatus: 'disabled' },
          { isActive: false }
        ]
      });
    }

    if (search && String(search).trim()) {
      const escapedSearch = String(search)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const regex = new RegExp(escapedSearch, 'i');

      const matchingShops = await Shop.find({
        name: regex
      })
        .select('_id')
        .lean();

      conditions.push({
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { phoneNumber: regex },
          {
            shopId: {
              $in: matchingShops.map(shop => shop._id)
            }
          }
        ]
      });
    }

    const query =
      conditions.length > 0
        ? { $and: conditions }
        : {};

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .populate({
          path: 'shopId',
          populate: { path: 'subscriptionId' }
        })
        .populate('subscriptionId')
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip((pageNum - 1) * limitNum)
        .lean(),

      User.countDocuments(query)
    ]);

    const shopIds = users
      .filter(
        user =>
          user.role === 'shop_owner' &&
          user.shopId &&
          typeof user.shopId === 'object' &&
          user.shopId._id
      )
      .map(user => user.shopId._id);

    const operatorIds = users
      .filter(user => user.role === 'operator')
      .map(user => user._id);

    const [
      shopOrderCounts,
      operatorOrderCounts
    ] = await Promise.all([
      shopIds.length > 0
        ? Order.aggregate([
            {
              $match: {
                shopId: { $in: shopIds }
              }
            },
            {
              $group: {
                _id: '$shopId',
                count: { $sum: 1 }
              }
            }
          ])
        : [],

      operatorIds.length > 0
        ? Order.aggregate([
            {
              $match: {
                assignedOperatorId: {
                  $in: operatorIds
                }
              }
            },
            {
              $group: {
                _id: '$assignedOperatorId',
                count: { $sum: 1 }
              }
            }
          ])
        : []
    ]);

    const shopCountMap = new Map(
      shopOrderCounts.map(item => [
        String(item._id),
        item.count
      ])
    );

    const operatorCountMap = new Map(
      operatorOrderCounts.map(item => [
        String(item._id),
        item.count
      ])
    );

    const normalizedUsers = users.map(user => {
      const userSub =
        user.subscriptionId &&
        typeof user.subscriptionId === 'object' &&
        user.subscriptionId._id
          ? user.subscriptionId
          : null;

      const shopSub =
        user.shopId &&
        typeof user.shopId === 'object' &&
        user.shopId.subscriptionId &&
        typeof user.shopId.subscriptionId === 'object' &&
        user.shopId.subscriptionId._id
          ? user.shopId.subscriptionId
          : null;

      const subscription = userSub || shopSub || null;

      const shop =
        user.shopId &&
        typeof user.shopId === 'object'
          ? user.shopId
          : null;

      const accountStatus =
        user.accountStatus === 'pending'
          ? 'pending'
          : (
              user.accountStatus === 'disabled' ||
              user.isActive === false
                ? 'disabled'
                : 'active'
            );

      let orderCount = 0;

      if (user.role === 'shop_owner' && shop?._id) {
        orderCount =
          shopCountMap.get(String(shop._id)) || 0;
      }

      if (user.role === 'operator') {
        orderCount =
          operatorCountMap.get(String(user._id)) || 0;
      }

      return {
        _id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
        isWhatsappLinked: user.isWhatsappLinked,
        country: user.country,
        isActive: user.isActive,
        accountStatus,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLogin: user.lastLogin || null,
        lastActivity: user.lastLogin || null,
        orderCount,
        shop,
        subscription
      };
    });

    res.json({
      users: normalizedUsers,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum
    });
  } catch (error) {
    next(error);
  }
});


/**
 * GET /api/admin/users/:id/details
 * Full account + shop + order statistics.
 */
router.get(
  '/users/:id/details',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id)
        .select('-password')
        .populate({
          path: 'shopId',
          populate: {
            path: 'subscriptionId'
          }
        })
        .populate('subscriptionId')
        .lean();

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      const shop =
        user.shopId &&
        typeof user.shopId === 'object'
          ? user.shopId
          : null;

      const accountStatus =
        user.accountStatus === 'pending'
          ? 'pending'
          : (
              user.accountStatus === 'disabled' ||
              user.isActive === false
                ? 'disabled'
                : 'active'
            );

      let orderMatch = null;

      if (user.role === 'shop_owner' && shop?._id) {
        orderMatch = {
          shopId: shop._id
        };
      } else if (user.role === 'operator') {
        orderMatch = {
          $or: [
            {
              assignedOperatorId: user._id
            },
            {
              confirmedByOperatorId: user._id
            }
          ]
        };
      }

      let stats = {
        totalOrders: 0,
        confirmedOrders: 0,
        cancelledOrders: 0,
        postponedOrders: 0,
        attempts: 0,
        confirmationRate: 0,
        averageAiScore: null
      };

      if (orderMatch) {
        const result = await Order.aggregate([
          {
            $match: orderMatch
          },
          {
            $group: {
              _id: null,

              totalOrders: {
                $sum: 1
              },

              confirmedOrders: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'confirmed'] },
                    1,
                    0
                  ]
                }
              },

              cancelledOrders: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'cancelled'] },
                    1,
                    0
                  ]
                }
              },

              postponedOrders: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'postponed'] },
                    1,
                    0
                  ]
                }
              },

              attempts: {
                $sum: {
                  $size: {
                    $ifNull: ['$callHistory', []]
                  }
                }
              },

              averageAiScore: {
                $avg: '$aiScore'
              }
            }
          }
        ]);

        if (result[0]) {
          stats = {
            totalOrders:
              result[0].totalOrders || 0,

            confirmedOrders:
              result[0].confirmedOrders || 0,

            cancelledOrders:
              result[0].cancelledOrders || 0,

            postponedOrders:
              result[0].postponedOrders || 0,

            attempts:
              result[0].attempts || 0,

            confirmationRate:
              result[0].totalOrders > 0
                ? parseFloat(
                    (
                      (
                        result[0].confirmedOrders /
                        result[0].totalOrders
                      ) * 100
                    ).toFixed(1)
                  )
                : 0,

            averageAiScore:
              typeof result[0].averageAiScore === 'number'
                ? parseFloat(
                    result[0].averageAiScore.toFixed(1)
                  )
                : null
          };
        }
      }

      res.json({
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          whatsappNumber: user.whatsappNumber,
          country: user.country,
          role: user.role,
          isActive: user.isActive,
          accountStatus,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastLogin: user.lastLogin || null
        },

        shop: shop
          ? {
              _id: shop._id,
              name: shop.name,
              domain: shop.domain,
              platform: shop.platform,
              createdAt: shop.createdAt,
              isActive: shop.isActive,
              numberOfShops: 1
            }
          : {
              numberOfShops: 0
            },

        stats
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * PATCH /api/admin/users/:id
 * Modify user and attached shop name.
 */
router.patch(
  '/users/:id',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const {
        firstName,
        lastName,
        email,
        phoneNumber,
        shopName
      } = req.body;

      const user = await User.findById(req.params.id);

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      if (
        typeof email === 'string' &&
        email.trim() &&
        email.trim().toLowerCase() !== user.email
      ) {
        const existing = await User.findOne({
          email: email.trim().toLowerCase(),
          _id: { $ne: user._id }
        });

        if (existing) {
          return res.status(409).json({
            error: 'Email already in use'
          });
        }

        user.email = email.trim().toLowerCase();
      }

      if (
        typeof firstName === 'string' &&
        firstName.trim()
      ) {
        user.firstName = firstName.trim();
      }

      if (
        typeof lastName === 'string' &&
        lastName.trim()
      ) {
        user.lastName = lastName.trim();
      }

      if (
        typeof phoneNumber === 'string' &&
        phoneNumber.trim()
      ) {
        user.phoneNumber = phoneNumber.trim();
      }

      await user.save();

      if (
        user.shopId &&
        typeof shopName === 'string' &&
        shopName.trim()
      ) {
        await Shop.findByIdAndUpdate(
          user.shopId,
          {
            $set: {
              name: shopName.trim()
            }
          }
        );
      }

      const { logActivity } = require(
        '../services/activityLogService'
      );

      await logActivity(
        'user',
        'Informations utilisateur modifiées',
        `${user.firstName} ${user.lastName} (${user.email})`
      );

      res.json({
        message: 'User updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * PATCH /api/admin/users/:id/status
 * Explicit account status management.
 */
router.patch(
  '/users/:id/status',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const { status } = req.body;

      if (
        !['pending', 'active', 'disabled'].includes(status)
      ) {
        return res.status(400).json({
          error: 'Invalid account status'
        });
      }

      const user = await User.findById(req.params.id);

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      user.accountStatus = status;
      user.isActive = status === 'active';

      await user.save();

      const { logActivity } = require(
        '../services/activityLogService'
      );

      const actionMap = {
        pending: 'Compte utilisateur en attente',
        active: 'Compte utilisateur activé',
        disabled: 'Compte utilisateur désactivé'
      };

      await logActivity(
        'user',
        actionMap[status],
        `${user.firstName} ${user.lastName} (${user.email})`
      );

      res.json({
        message: 'User status updated',
        status
      });
    } catch (error) {
      next(error);
    }
  }
);


// Toggle user status
router.patch('/users/:id/toggle-status', auth, authorize('admin'), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isActive = !user.isActive;
    user.accountStatus =
      user.isActive ? 'active' : 'disabled';

    await user.save();

    const { logActivity } = require('../services/activityLogService');

    await logActivity(
      'user',
      user.isActive ? 'Compte utilisateur activé' : 'Compte utilisateur désactivé',
      `${user.firstName} ${user.lastName} (${user.email})`
    );

    res.json({ message: `User ${user.isActive ? 'activated' : 'deactivated'}` });
  } catch (error) {
    next(error);
  }
});


// ==========================================================
// ADMIN - OPERATOR MANAGEMENT
// ==========================================================

/**
 * GET /api/admin/operators
 *
 * Liste complète avec statistiques réelles.
 *
 * availabilityStatus:
 * - disabled  : compte désactivé
 * - busy      : au moins une commande in_progress
 * - available : activité opérateur dans les 5 dernières minutes
 * - offline   : aucune activité récente
 */
router.get(
  '/operators',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const operators = await User.find({
        role: 'operator'
      })
        .select('-password')
        .populate(
          'shopId',
          'name domain platform isActive'
        )
        .sort({
          createdAt: -1
        })
        .lean();

      const operatorIds = operators.map(
        operator => operator._id
      );

      const [
        assignedStats,
        processedStats,
        confirmedStats,
        busyStats,
        shops
      ] = await Promise.all([
        operatorIds.length
          ? Order.aggregate([
              {
                $match: {
                  assignedOperatorId: {
                    $in: operatorIds
                  },
                  status: {
                    $in: [
                      'assigned',
                      'in_progress',
                      'postponed'
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: '$assignedOperatorId',
                  count: {
                    $sum: 1
                  }
                }
              }
            ])
          : [],

        operatorIds.length
          ? Order.aggregate([
              {
                $unwind: '$callHistory'
              },
              {
                $match: {
                  'callHistory.operatorId': {
                    $in: operatorIds
                  }
                }
              },
              {
                $group: {
                  _id: '$callHistory.operatorId',
                  orders: {
                    $addToSet: '$_id'
                  }
                }
              },
              {
                $project: {
                  count: {
                    $size: '$orders'
                  }
                }
              }
            ])
          : [],

        operatorIds.length
          ? Order.aggregate([
              {
                $unwind: '$callHistory'
              },
              {
                $match: {
                  'callHistory.operatorId': {
                    $in: operatorIds
                  },
                  'callHistory.result':
                    'confirmed'
                }
              },
              {
                $group: {
                  _id: '$callHistory.operatorId',
                  orders: {
                    $addToSet: '$_id'
                  }
                }
              },
              {
                $project: {
                  count: {
                    $size: '$orders'
                  }
                }
              }
            ])
          : [],

        operatorIds.length
          ? Order.aggregate([
              {
                $match: {
                  assignedOperatorId: {
                    $in: operatorIds
                  },
                  status: 'in_progress'
                }
              },
              {
                $group: {
                  _id: '$assignedOperatorId',
                  count: {
                    $sum: 1
                  }
                }
              }
            ])
          : [],

        Shop.find({
          isActive: true
        })
          .select('_id name')
          .sort({
            name: 1
          })
          .lean()
      ]);

      const toMap = data =>
        new Map(
          data.map(item => [
            String(item._id),
            item.count || 0
          ])
        );

      const assignedMap =
        toMap(assignedStats);

      const processedMap =
        toMap(processedStats);

      const confirmedMap =
        toMap(confirmedStats);

      const busyMap =
        toMap(busyStats);

      const now = Date.now();

      const result = operators.map(
        operator => {
          const id =
            String(operator._id);

          const accountStatus =
            operator.accountStatus ===
              'disabled' ||
            operator.isActive === false
              ? 'disabled'
              : operator.accountStatus ===
                  'pending'
                ? 'pending'
                : 'active';

          const lastActiveAt =
            operator.lastActiveAt
              ? new Date(
                  operator.lastActiveAt
                )
              : null;

          const recentlyActive =
            !!lastActiveAt &&
            now -
              lastActiveAt.getTime() <=
              5 * 60 * 1000;

          let availabilityStatus =
            'offline';

          if (
            accountStatus === 'disabled'
          ) {
            availabilityStatus =
              'disabled';
          } else if (
            (busyMap.get(id) || 0) > 0
          ) {
            availabilityStatus =
              'busy';
          } else if (recentlyActive) {
            availabilityStatus =
              'available';
          }

          return {
            _id: operator._id,
            firstName:
              operator.firstName,
            lastName:
              operator.lastName,
            email: operator.email,
            phoneNumber:
              operator.phoneNumber,
            createdAt:
              operator.createdAt,
            lastLogin:
              operator.lastLogin || null,
            lastActiveAt:
              operator.lastActiveAt ||
              null,
            isActive:
              operator.isActive,
            accountStatus,
            availabilityStatus,

            shop:
              operator.shopId &&
              typeof operator.shopId ===
                'object'
                ? operator.shopId
                : null,

            assignedOrders:
              assignedMap.get(id) || 0,

            processedOrders:
              processedMap.get(id) || 0,

            confirmedOrders:
              confirmedMap.get(id) || 0
          };
        }
      );

      res.json({
        operators: result,
        shops
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/admin/operators
 * Création réelle d'un compte opérateur.
 */
router.post(
  '/operators',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const {
        firstName,
        lastName,
        email,
        phoneNumber,
        password,
        shopId,
        status = 'active'
      } = req.body;

      const missingFields = [];

      if (!firstName)
        missingFields.push('firstName');

      if (!lastName)
        missingFields.push('lastName');

      if (!email)
        missingFields.push('email');

      if (!phoneNumber)
        missingFields.push('phoneNumber');

      if (!password)
        missingFields.push('password');

      if (!shopId)
        missingFields.push('shopId');

      if (missingFields.length > 0) {
        return res.status(400).json({
          error:
            `Missing required fields: ${missingFields.join(
              ', '
            )}`
        });
      }

      if (
        typeof password !== 'string' ||
        password.length < 6
      ) {
        return res.status(400).json({
          error:
            'Password must be at least 6 characters'
        });
      }

      if (
        !['active', 'disabled'].includes(
          status
        )
      ) {
        return res.status(400).json({
          error:
            'Invalid operator account status'
        });
      }

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      const existingUser =
        await User.findOne({
          email: normalizedEmail
        });

      if (existingUser) {
        return res.status(409).json({
          error:
            'Email already in use'
        });
      }

      const shop =
        await Shop.findOne({
          _id: shopId,
          isActive: true
        });

      if (!shop) {
        return res.status(400).json({
          error:
            'Active shop not found'
        });
      }

      const operator = new User({
        firstName:
          String(firstName).trim(),

        lastName:
          String(lastName).trim(),

        email: normalizedEmail,

        phoneNumber:
          String(phoneNumber).trim(),

        // User exige actuellement un numéro WhatsApp.
        // Le téléphone est utilisé par défaut.
        whatsappNumber:
          String(phoneNumber).trim(),

        isWhatsappLinked: false,

        country: 'Tunisia',

        password,

        role: 'operator',

        shopId: shop._id,

        accountStatus: status,

        isActive:
          status === 'active'
      });

      await operator.save();

      const { logActivity } = require(
        '../services/activityLogService'
      );

      await logActivity(
        'operator',
        'Nouvel opérateur créé',
        `${operator.firstName} ${operator.lastName} — ${shop.name}`
      );

      res.status(201).json({
        message:
          'Operator created successfully',
        operator: {
          _id: operator._id,
          firstName:
            operator.firstName,
          lastName:
            operator.lastName,
          email: operator.email
        }
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * PATCH /api/admin/operators/:id
 * Modifier les données opérateur.
 *
 * Le mot de passe est optionnel lors d'une modification.
 */
router.patch(
  '/operators/:id',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const operator =
        await User.findOne({
          _id: req.params.id,
          role: 'operator'
        });

      if (!operator) {
        return res.status(404).json({
          error:
            'Operator not found'
        });
      }

      const {
        firstName,
        lastName,
        email,
        phoneNumber,
        password,
        shopId
      } = req.body;

      if (
        typeof email === 'string' &&
        email.trim()
      ) {
        const normalizedEmail =
          email.trim().toLowerCase();

        const duplicate =
          await User.findOne({
            email: normalizedEmail,
            _id: {
              $ne: operator._id
            }
          });

        if (duplicate) {
          return res.status(409).json({
            error:
              'Email already in use'
          });
        }

        operator.email =
          normalizedEmail;
      }

      if (
        typeof firstName ===
          'string' &&
        firstName.trim()
      ) {
        operator.firstName =
          firstName.trim();
      }

      if (
        typeof lastName ===
          'string' &&
        lastName.trim()
      ) {
        operator.lastName =
          lastName.trim();
      }

      if (
        typeof phoneNumber ===
          'string' &&
        phoneNumber.trim()
      ) {
        operator.phoneNumber =
          phoneNumber.trim();

        operator.whatsappNumber =
          phoneNumber.trim();
      }

      if (shopId) {
        const shop =
          await Shop.findOne({
            _id: shopId,
            isActive: true
          });

        if (!shop) {
          return res.status(400).json({
            error:
              'Active shop not found'
          });
        }

        operator.shopId =
          shop._id;
      }

      if (
        typeof password ===
          'string' &&
        password.length > 0
      ) {
        if (password.length < 6) {
          return res.status(400).json({
            error:
              'Password must be at least 6 characters'
          });
        }

        operator.password =
          password;
      }

      await operator.save();

      const { logActivity } = require(
        '../services/activityLogService'
      );

      await logActivity(
        'operator',
        'Informations opérateur modifiées',
        `${operator.firstName} ${operator.lastName} (${operator.email})`
      );

      res.json({
        message:
          'Operator updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);



// Plan feature definitions for subscription updates
const PLAN_FEATURES = {
  pro: {
    maxOperators: 15,
    maxAICalls: 500,
    maxShops: 3,
    prioritySupport: true,
    customIntegrations: false,
    widgets: ['kpi-basic', 'recent-orders', 'risk-score', 'operator-feedback'],
    advancedAnalytics: true,
    predictiveAnalytics: false
  },
  business: {
    maxOperators: 50,
    maxAICalls: 2000,
    maxShops: 10,
    prioritySupport: true,
    customIntegrations: true,
    widgets: ['kpi-basic', 'recent-orders', 'risk-score', 'operator-feedback', 'complaints', 'courier-performance'],
    advancedAnalytics: true,
    predictiveAnalytics: false
  },
  enterprise: {
    maxOperators: -1,
    maxAICalls: -1,
    maxShops: -1,
    prioritySupport: true,
    customIntegrations: true,
    widgets: ['kpi-basic', 'recent-orders', 'risk-score', 'operator-feedback', 'complaints', 'courier-performance', 'predictive', 'automation'],
    advancedAnalytics: true,
    predictiveAnalytics: true
  }
};

const PLAN_PRICING = {
  pro: { amount: 49, currency: 'USD', interval: 'monthly' },
  business: { amount: 99, currency: 'USD', interval: 'monthly' },
  enterprise: { amount: 199, currency: 'USD', interval: 'monthly' }
};

/**
 * PATCH /api/admin/users/:userId/subscription
 * Update a user's subscription plan
 */
router.patch('/users/:userId/subscription', auth, authorize('admin'), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { plan } = req.body;

    // Validate plan
    const validPlans = ['pro', 'business', 'enterprise'];
    if (!plan || !validPlans.includes(plan)) {
      return res.status(400).json({ 
        error: 'Invalid plan. Must be one of: pro, business, enterprise' 
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const features = PLAN_FEATURES[plan];
    const pricing = PLAN_PRICING[plan];
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    let subscription;
    let shop = null;

    // Check if user has a shop
    if (user.shopId) {
      shop = await Shop.findById(user.shopId);
    }

    // Determine existing subscription ID (from shop or user)
    const existingSubscriptionId = shop?.subscriptionId || user.subscriptionId;

    if (existingSubscriptionId) {
      // Update existing subscription
      subscription = await Subscription.findByIdAndUpdate(
        existingSubscriptionId,
        {
          plan,
          features,
          pricing,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd
        },
        { new: true }
      );
    } else {
      // Create new subscription
      subscription = new Subscription({
        plan,
        features,
        pricing,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd
      });
      await subscription.save();

      // Link subscription to both user and shop (if exists)
      user.subscriptionId = subscription._id;
      await user.save();

      if (shop) {
        shop.subscriptionId = subscription._id;
        await shop.save();
      }
    }

    res.json({
      message: `Subscription updated to ${plan} plan`,
      subscription: {
        _id: subscription._id,
        plan: subscription.plan,
        status: subscription.status,
        features: subscription.features,
        pricing: subscription.pricing,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd
      }
    });
  } catch (error) {
    next(error);
  }
});


// ==========================================================
// AI SCORING ENGINE — READ ONLY
// ==========================================================

/**
 * GET /api/admin/ai-scoring/shops
 *
 * Return active shops for the AI scoring simulator.
 */
router.get(
  '/ai-scoring/shops',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const shops =
        await Shop
          .find({
            isActive: true
          })
          .select({
            _id: 1,
            name: 1
          })
          .sort({
            name: 1
          })
          .lean();

      return res.json({
        shops: shops.map(
          shop => ({
            id: String(shop._id),
            name: shop.name
          })
        )
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * GET /api/admin/ai-scoring/configs
 * List all scoring configuration versions.
 */
router.get(
  '/ai-scoring/configs',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const configs =
        await AIScoringConfig
          .find({})
          .select({
            version: 1,
            status: 1,
            notes: 1,
            createdBy: 1,
            activatedBy: 1,
            activatedAt: 1,
            clonedFromVersion: 1,
            createdAt: 1,
            updatedAt: 1
          })
          .sort({
            version: -1
          })
          .lean();

      return res.json({
        configs
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/ai-scoring/active
 * Return the currently active scoring configuration.
 */
router.get(
  '/ai-scoring/active',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const config =
        await AIScoringConfig
          .findOne({
            status: 'active'
          })
          .lean();

      return res.json({
        active: Boolean(config),
        config: config || null
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/ai-scoring/configs/:version
 * Return one complete scoring configuration version.
 */
router.get(
  '/ai-scoring/configs/:version',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration version'
        });
      }

      const config =
        await AIScoringConfig
          .findOne({
            version
          })
          .lean();

      if (!config) {
        return res.status(404).json({
          error:
            'AI scoring configuration not found'
        });
      }

      return res.json({
        config
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * PUT /api/admin/ai-scoring/configs/:version
 *
 * Update an existing draft configuration.
 * Version/status/activation metadata cannot be changed here.
 */
router.put(
  '/ai-scoring/configs/:version',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration version'
        });
      }

      const config =
        await AIScoringConfig.findOne({
          version
        });

      if (!config) {
        return res.status(404).json({
          error:
            'AI scoring configuration not found'
        });
      }

      if (config.status !== 'draft') {
        return res.status(409).json({
          error:
            'Only draft AI scoring configurations can be edited'
        });
      }

      const allowedFields = [
        'general',
        'patterns',
        'customerHistory',
        'operatorFeedback',
        'notes'
      ];

      const suppliedFields =
        Object.keys(req.body || {});

      const forbiddenFields =
        suppliedFields.filter(
          field =>
            !allowedFields.includes(field)
        );

      if (forbiddenFields.length > 0) {
        return res.status(400).json({
          error:
            'Unsupported AI scoring configuration fields',
          fields: forbiddenFields
        });
      }

      if (suppliedFields.length === 0) {
        return res.status(400).json({
          error:
            'No AI scoring configuration fields supplied'
        });
      }

      for (const field of allowedFields) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body,
            field
          )
        ) {
          config.set(
            field,
            req.body[field]
          );
        }
      }

      await config.validate();

      const validation =
        aiScoringConfigValidator
          .validateForActivation(
            config.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration',
          details:
            validation.errors
        });
      }

      await config.save();

      return res.json({
        message:
          'AI scoring draft configuration updated',
        config
      });
    } catch (error) {
      if (
        error?.name ===
        'ValidationError'
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration',
          details:
            Object.values(
              error.errors || {}
            ).map(
              item => item.message
            )
        });
      }

      next(error);
    }
  }
);


/**
 * DELETE /api/admin/ai-scoring/configs/:version
 *
 * Delete one draft configuration.
 * Active and archived configurations are protected.
 */
router.delete(
  '/ai-scoring/configs/:version',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration version'
        });
      }

      const config =
        await AIScoringConfig
          .findOne({
            version
          })
          .select({
            _id: 1,
            version: 1,
            status: 1
          })
          .lean();

      if (!config) {
        return res.status(404).json({
          error:
            'AI scoring configuration not found'
        });
      }

      if (config.status !== 'draft') {
        return res.status(409).json({
          error:
            'Only draft AI scoring configurations can be deleted'
        });
      }

      const deletion =
        await AIScoringConfig.deleteOne({
          _id: config._id,
          status: 'draft'
        });

      if (deletion.deletedCount !== 1) {
        return res.status(409).json({
          error:
            'AI scoring draft could not be deleted'
        });
      }

      return res.json({
        message:
          `AI scoring draft V${version} deleted`,
        version
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/admin/ai-scoring/configs/:version/clone
 *
 * Clone an existing configuration into a new draft version.
 */
router.post(
  '/ai-scoring/configs/:version/clone',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const sourceVersion =
        Number(req.params.version);

      if (
        !Number.isInteger(sourceVersion) ||
        sourceVersion < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration version'
        });
      }

      const source =
        await AIScoringConfig.findOne({
          version: sourceVersion
        });

      if (!source) {
        return res.status(404).json({
          error:
            'AI scoring configuration not found'
        });
      }

      const latest =
        await AIScoringConfig
          .findOne({})
          .sort({ version: -1 })
          .select({ version: 1 })
          .lean();

      const newVersion =
        (latest?.version || 0) + 1;

      const cloneData =
        source.toObject({
          depopulate: true
        });

      delete cloneData._id;
      delete cloneData.__v;
      delete cloneData.version;
      delete cloneData.status;
      delete cloneData.createdBy;
      delete cloneData.activatedBy;
      delete cloneData.activatedAt;
      delete cloneData.clonedFromVersion;
      delete cloneData.createdAt;
      delete cloneData.updatedAt;

      const clone =
        new AIScoringConfig({
          ...cloneData,

          version: newVersion,
          status: 'draft',

          createdBy:
            req.user._id,

          clonedFromVersion:
            sourceVersion,

          activatedBy: null,
          activatedAt: null
        });

      await clone.validate();

      const validation =
        aiScoringConfigValidator
          .validateForActivation(
            clone.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'Cannot clone invalid AI scoring configuration',
          details:
            validation.errors
        });
      }

      await clone.save();

      return res.status(201).json({
        message:
          `AI scoring configuration V${newVersion} created as draft`,
        config: clone
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error:
            'AI scoring version conflict. Please retry.'
        });
      }

      next(error);
    }
  }
);


/**
 * POST /api/admin/ai-scoring/configs/:version/simulate
 *
 * Run the real AI scoring engine against a temporary order.
 *
 * IMPORTANT:
 * - no Order document is created;
 * - no score is persisted;
 * - no configuration is activated;
 * - historical data is read only.
 */
router.post(
  '/ai-scoring/configs/:version/simulate',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration version'
        });
      }

      const scoringConfig =
        await AIScoringConfig
          .findOne({
            version
          })
          .select({
            version: 1,
            status: 1,
            general: 1,
            patterns: 1,
            customerHistory: 1,
            operatorFeedback: 1
          })
          .lean();

      if (!scoringConfig) {
        return res.status(404).json({
          error:
            'AI scoring configuration not found'
        });
      }

      const input =
        req.body?.order;

      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input)
      ) {
        return res.status(400).json({
          error:
            'A simulated order object is required'
        });
      }

      const totalAmount =
        Number(input.totalAmount);

      if (
        !Number.isFinite(totalAmount) ||
        totalAmount < 0
      ) {
        return res.status(400).json({
          error:
            'Simulation totalAmount must be a non-negative number'
        });
      }

      let createdAt =
        new Date();

      if (input.createdAt) {
        createdAt =
          new Date(input.createdAt);

        if (
          Number.isNaN(
            createdAt.getTime()
          )
        ) {
          return res.status(400).json({
            error:
              'Simulation createdAt is invalid'
          });
        }
      }

      /*
       * Build only an in-memory order-like object.
       * It is never saved through the Order model.
       */
      const simulatedOrder = {
        shopId:
          input.shopId || null,

        clientInfo: {
          name:
            input.clientInfo?.name || '',

          phone:
            input.clientInfo?.phone || '',

          address: {
            street:
              input.clientInfo
                ?.address
                ?.street || '',

            city:
              input.clientInfo
                ?.address
                ?.city || '',

            state:
              input.clientInfo
                ?.address
                ?.state || '',

            zipCode:
              input.clientInfo
                ?.address
                ?.zipCode || ''
          }
        },

        region:
          input.region || '',

        totalAmount,

        createdAt,

        operatorFeedback:
          input.operatorFeedback || null
      };

      /*
       * Read historical context with the exact same service
       * used by production scoring.
       *
       * Without shopId the service safely returns an empty
       * historical context.
       */
      const context =
        await aiScoringService
          .buildScoringContext(
            simulatedOrder
          );

      const result =
        aiScoringService
          .calculateAIScore(
            simulatedOrder,
            context,
            scoringConfig
          );

      return res.json({
        version:
          scoringConfig.version,

        status:
          scoringConfig.status,

        simulation: {
          baseScore:
            result.baseScore,

          calculatedScore:
            result.calculatedScore,

          minimumScore:
            result.minimumScore,

          maximumScore:
            result.maximumScore,

          finalScore:
            result.score,

          factors:
            result.factors || [],

          riskLevel:
            aiScoringService
              .calculateRiskLevel(
                result.score
              ),

          decision:
            aiScoringService
              .calculateDecision(
                result.score
              )
        },

        context
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/admin/ai-scoring/configs/:version/activate
 *
 * Activate a draft AI scoring configuration.
 *
 * MongoDB currently runs without replica-set transactions.
 * When replacing an active configuration, the previous
 * version is archived first. If activation fails, the
 * previous version is restored automatically.
 */
router.post(
  '/ai-scoring/configs/:version/activate',
  auth,
  authorize('admin'),
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration version'
        });
      }

      const target =
        await AIScoringConfig.findOne({
          version
        });

      if (!target) {
        return res.status(404).json({
          error:
            'AI scoring configuration not found'
        });
      }

      if (target.status !== 'draft') {
        return res.status(409).json({
          error:
            'Only draft AI scoring configurations can be activated'
        });
      }

      /*
       * Validate the complete configuration immediately
       * before activation.
       */
      await target.validate();

      const validation =
        aiScoringConfigValidator
          .validateForActivation(
            target.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'AI scoring configuration cannot be activated',
          details:
            validation.errors
        });
      }

      const activeConfig =
        await AIScoringConfig
          .findOne({
            status: 'active'
          })
          .select({
            _id: 1,
            version: 1
          })
          .lean();

      const activatedAt =
        new Date();

      const activationUpdate = {
        $set: {
          status: 'active',
          activatedBy:
            req.user._id,
          activatedAt
        }
      };

      /*
       * CASE 1:
       * No active configuration exists.
       *
       * This is a single-document atomic activation.
       */
      if (!activeConfig) {
        const activated =
          await AIScoringConfig
            .findOneAndUpdate(
              {
                version,
                status: 'draft'
              },
              activationUpdate,
              {
                new: true,
                runValidators: true
              }
            );

        if (!activated) {
          return res.status(409).json({
            error:
              'AI scoring configuration activation conflict'
          });
        }

        return res.json({
          message:
            `AI scoring configuration V${version} activated`,
          previousVersion: null,
          config: activated
        });
      }

      /*
       * CASE 2:
       * Replace an existing active configuration.
       *
       * MongoDB is standalone, so there is no multi-document
       * transaction. We therefore:
       *
       * 1. archive the current active version conditionally;
       * 2. activate the requested draft;
       * 3. restore the old version if step 2 fails.
       */

      const archived =
        await AIScoringConfig
          .findOneAndUpdate(
            {
              _id:
                activeConfig._id,
              status: 'active'
            },
            {
              $set: {
                status: 'archived'
              }
            },
            {
              new: true,
              runValidators: true
            }
          );

      if (!archived) {
        return res.status(409).json({
          error:
            'Active AI scoring configuration changed during activation'
        });
      }

      let activated = null;

      try {
        activated =
          await AIScoringConfig
            .findOneAndUpdate(
              {
                version,
                status: 'draft'
              },
              activationUpdate,
              {
                new: true,
                runValidators: true
              }
            );

        if (!activated) {
          throw new Error(
            'TARGET_ACTIVATION_CONFLICT'
          );
        }
      } catch (activationError) {
        /*
         * Roll back the previous active configuration.
         */
        try {
          const restored =
            await AIScoringConfig
              .findOneAndUpdate(
                {
                  _id:
                    activeConfig._id,
                  status: 'archived'
                },
                {
                  $set: {
                    status: 'active'
                  }
                },
                {
                  new: true,
                  runValidators: true
                }
              );

          if (!restored) {
            const rollbackError =
              new Error(
                'AI_SCORING_ACTIVATION_ROLLBACK_FAILED'
              );

            rollbackError.cause =
              activationError;

            throw rollbackError;
          }
        } catch (rollbackError) {
          rollbackError.activationError =
            activationError;

          throw rollbackError;
        }

        if (
          activationError.message ===
          'TARGET_ACTIVATION_CONFLICT'
        ) {
          return res.status(409).json({
            error:
              'AI scoring configuration activation conflict. Previous active version restored.',
            activeVersion:
              activeConfig.version
          });
        }

        throw activationError;
      }

      return res.json({
        message:
          `AI scoring configuration V${version} activated`,
        previousVersion:
          activeConfig.version,
        config: activated
      });
    } catch (error) {
      /*
       * The unique partial index on status=active is
       * the final database-level concurrency protection.
       */
      if (error?.code === 11000) {
        return res.status(409).json({
          error:
            'Another AI scoring configuration became active first'
        });
      }

      if (
        error?.name ===
        'ValidationError'
      ) {
        return res.status(400).json({
          error:
            'Invalid AI scoring configuration',
          details:
            Object.values(
              error.errors || {}
            ).map(
              item => item.message
            )
        });
      }

      next(error);
    }
  }
);

/*
 * Global carrier-status mapping administration.
 */
router.use(
  '/carrier-status',
  adminCarrierStatusRoutes
);

module.exports = router;
