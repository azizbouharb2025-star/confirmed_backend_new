const express = require('express');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
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

    res.json({
      totalUsers,
      totalUsersChange: pct(thisWeekUsers, prevWeekUsers),
      totalOrders,
      totalOrdersChange: pct(thisWeekOrders, prevWeekOrders),
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
router.get('/users', auth, authorize('admin'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, role } = req.query;
    const query = role ? { role } : {};

    const users = await User.find(query)
      .select('-password')
      .populate({
        path: 'shopId',
        populate: { path: 'subscriptionId' }
      })
      .populate('subscriptionId')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await User.countDocuments(query);

    // Resolve subscription from all possible locations
    const normalizedUsers = users.map(user => {
      // Subscription can live on the user directly or through the shop
      const userSub = user.subscriptionId && typeof user.subscriptionId === 'object' && user.subscriptionId._id
        ? user.subscriptionId
        : null;
      const shopSub = user.shopId && typeof user.shopId === 'object'
        && user.shopId.subscriptionId && typeof user.shopId.subscriptionId === 'object'
        && user.shopId.subscriptionId._id
        ? user.shopId.subscriptionId
        : null;

      const subscription = userSub || shopSub || null;
      const shop = user.shopId && typeof user.shopId === 'object' ? user.shopId : null;

      // Build a clean response without raw ref fields
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        shop,
        subscription
      };
    });

    res.json({
      users: normalizedUsers,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (error) {
    next(error);
  }
});

// Toggle user status
router.patch('/users/:id/toggle-status', auth, authorize('admin'), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({ message: `User ${user.isActive ? 'activated' : 'deactivated'}` });
  } catch (error) {
    next(error);
  }
});

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

module.exports = router;