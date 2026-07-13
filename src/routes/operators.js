const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const queueService = require('../services/queueService');
const Order = require('../models/Order');
const User = require('../models/User');
const Mission = require('../models/Mission');
const OperatorWallet = require('../models/OperatorWallet');
const RewardTransaction = require('../models/RewardTransaction');

const router = express.Router();

// Get next order for operator
router.get('/next-order', auth, authorize('operator'), async (req, res, next) => {
  try {
    const order = await queueService.assignNextOrder(req.user._id);
    
    if (!order) {
      return res.json({ message: 'No orders available' });
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Get operator stats
router.get('/stats', auth, authorize('operator'), async (req, res, next) => {
  try {
    const stats = await queueService.getOperatorStats(req.user._id);
    const queueLength = await queueService.getQueueLength();
    
    res.json({
      ...stats,
      queueLength
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/operators/kpis
 * Frontend reads: response.data directly (no wrapper)
 */
router.get('/kpis', auth, authorize('operator'), async (req, res, next) => {
  try {
    const operatorId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 7);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    // Confirmation rate (last 30 days)
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [rateStats, prevWeekStats, callsToday, callsYesterday, queueCount, allOperatorRates] = await Promise.all([
      // Current week confirmation rate
      Order.aggregate([
        { $match: { assignedOperatorId: operatorId, updatedAt: { $gte: weekStart } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } }
          }
        }
      ]),
      // Previous week confirmation rate
      Order.aggregate([
        { $match: { assignedOperatorId: operatorId, updatedAt: { $gte: prevWeekStart, $lt: weekStart } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } }
          }
        }
      ]),
      // Calls today
      Order.countDocuments({
        assignedOperatorId: operatorId,
        'callHistory.operatorId': operatorId,
        'callHistory.timestamp': { $gte: today }
      }),
      // Calls yesterday
      Order.countDocuments({
        assignedOperatorId: operatorId,
        'callHistory.operatorId': operatorId,
        'callHistory.timestamp': { $gte: yesterday, $lt: today }
      }),
      // Queue length
      Order.countDocuments({
        $or: [
          { status: 'pending' },
          { assignedOperatorId: operatorId, status: { $in: ['pending', 'called'] } }
        ]
      }),
      // All operators' confirmation rates for ranking
      Order.aggregate([
        { $match: { assignedOperatorId: { $exists: true }, updatedAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: '$assignedOperatorId',
            total: { $sum: 1 },
            confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } }
          }
        },
        {
          $project: {
            rate: { $cond: [{ $gt: ['$total', 0] }, { $multiply: [{ $divide: ['$confirmed', '$total'] }, 100] }, 0] }
          }
        },
        { $sort: { rate: -1 } }
      ])
    ]);

    const curRate = rateStats[0] ? (rateStats[0].confirmed / Math.max(rateStats[0].total, 1)) * 100 : 0;
    const prevRate = prevWeekStats[0] ? (prevWeekStats[0].confirmed / Math.max(prevWeekStats[0].total, 1)) * 100 : 0;
    const confirmationRateChange = parseFloat((curRate - prevRate).toFixed(1));
    const callsTodayChange = callsYesterday > 0
      ? parseFloat((((callsToday - callsYesterday) / callsYesterday) * 100).toFixed(1))
      : 0;

    // Find rank
    const rankIndex = allOperatorRates.findIndex(o => o._id.toString() === operatorId.toString());
    const performanceRank = rankIndex >= 0 ? rankIndex + 1 : allOperatorRates.length + 1;

    res.json({
      confirmationRate: parseFloat(curRate.toFixed(1)),
      confirmationRateChange,
      callsToday,
      callsTodayChange,
      queueLength: queueCount,
      performanceRank
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/operators/missions
 * Frontend reads: response.data.missions
 */
router.get('/missions', auth, authorize('operator'), async (req, res, next) => {
  try {
    const operatorId = req.user._id;
    const now = new Date();

    // Auto-generate daily missions if none exist for today
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const existingDaily = await Mission.findOne({
      operatorId,
      type: 'daily',
      createdAt: { $gte: todayStart }
    });

    if (!existingDaily) {
      await Mission.insertMany([
        {
          operatorId,
          title: 'Daily Confirmation Goal',
          description: 'Confirm 20 orders today',
          target: 20,
          current: 0,
          reward: 10,
          rewardType: 'cash',
          type: 'daily',
          status: 'active',
          expiresAt: todayEnd
        },
        {
          operatorId,
          title: 'Call Streak',
          description: 'Make 30 calls today',
          target: 30,
          current: 0,
          reward: 5,
          rewardType: 'points',
          type: 'daily',
          status: 'active',
          expiresAt: todayEnd
        }
      ]);
    }

    // Update current progress for active missions
    const [confirmedToday, callsToday] = await Promise.all([
      Order.countDocuments({
        assignedOperatorId: operatorId,
        status: 'confirmed',
        updatedAt: { $gte: todayStart }
      }),
      Order.countDocuments({
        assignedOperatorId: operatorId,
        'callHistory.operatorId': operatorId,
        'callHistory.timestamp': { $gte: todayStart }
      })
    ]);

    // Bulk update current progress
    await Promise.all([
      Mission.updateMany(
        { operatorId, type: 'daily', status: 'active', title: /Confirmation/i, expiresAt: { $gte: now } },
        { $set: { current: confirmedToday } }
      ),
      Mission.updateMany(
        { operatorId, type: 'daily', status: 'active', title: /Call/i, expiresAt: { $gte: now } },
        { $set: { current: callsToday } }
      )
    ]);

    // Mark completed missions
    await Mission.updateMany(
      { operatorId, status: 'active', $expr: { $gte: ['$current', '$target'] } },
      { $set: { status: 'completed', completedAt: now } }
    );

    // Expire old missions
    await Mission.updateMany(
      { operatorId, status: 'active', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );

    const missions = await Mission.find({
      operatorId,
      expiresAt: { $gte: todayStart }
    }).sort({ createdAt: -1 }).lean();

    res.json({
      missions: missions.map(m => ({
        id: m._id,
        title: m.title,
        description: m.description,
        target: m.target,
        current: m.current,
        reward: m.reward,
        rewardType: m.rewardType,
        type: m.type,
        status: m.status,
        expiresAt: m.expiresAt,
        completedAt: m.completedAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/operators/missions/:missionId/claim
 * Frontend sends: empty body {}
 * Frontend expects: 200 OK
 */
router.post('/missions/:missionId/claim', auth, authorize('operator'), async (req, res, next) => {
  try {
    const operatorId = req.user._id;
    const mission = await Mission.findOne({ _id: req.params.missionId, operatorId });

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' });
    }
    if (mission.status !== 'completed') {
      return res.status(400).json({ error: 'Mission is not completed yet' });
    }

    mission.status = 'claimed';
    await mission.save();

    // Credit wallet
    await OperatorWallet.findOneAndUpdate(
      { operatorId },
      {
        $inc: { balance: mission.reward },
        $setOnInsert: { operatorId }
      },
      { upsert: true }
    );

    // Record transaction
    await new RewardTransaction({
      operatorId,
      amount: mission.reward,
      reason: `${mission.title} completed`,
      missionId: mission._id
    }).save();

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/operators/leaderboard
 * Frontend reads: response.data.operators
 */
router.get('/leaderboard', auth, authorize('operator', 'admin'), async (req, res, next) => {
  try {
    const operatorId = req.user._id;

    const leaderboard = await Order.aggregate([
      {
        $match: {
          assignedOperatorId: { $exists: true }
        }
      },
      {
        $group: {
          _id: '$assignedOperatorId',
          totalCalls: { $sum: 1 },
          confirmed: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'operator'
        }
      },
      { $unwind: '$operator' },
      {
        $project: {
          id: '$_id',
          name: { $concat: ['$operator.firstName', ' ', '$operator.lastName'] },
          avatar: null,
          confirmationRate: {
            $round: [{ $multiply: [{ $divide: ['$confirmed', { $max: ['$totalCalls', 1] }] }, 100] }, 1]
          },
          totalCalls: 1
        }
      },
      { $sort: { confirmationRate: -1 } },
      { $limit: 20 }
    ]);

    // Assign ranks
    let operators = leaderboard.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      avatar: entry.avatar,
      confirmationRate: entry.confirmationRate,
      totalCalls: entry.totalCalls,
      rank: index + 1
    }));

    // Ensure requesting operator is included
    const isIncluded = operators.some(o => o.id.toString() === operatorId.toString());
    if (!isIncluded && req.user.role === 'operator') {
      const myStats = await Order.aggregate([
        { $match: { assignedOperatorId: operatorId } },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } }
          }
        }
      ]);
      const s = myStats[0] || { totalCalls: 0, confirmed: 0 };
      const rate = s.totalCalls > 0 ? parseFloat(((s.confirmed / s.totalCalls) * 100).toFixed(1)) : 0;
      operators.push({
        id: operatorId,
        name: `${req.user.firstName} ${req.user.lastName}`,
        avatar: null,
        confirmationRate: rate,
        totalCalls: s.totalCalls,
        rank: operators.length + 1
      });
    }

    res.json({ operators });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/operators/rewards
 * Frontend reads: response.data directly
 */
router.get('/rewards', auth, authorize('operator'), async (req, res, next) => {
  try {
    const operatorId = req.user._id;

    // Ensure wallet exists
    let wallet = await OperatorWallet.findOne({ operatorId });
    if (!wallet) {
      wallet = await OperatorWallet.create({ operatorId, balance: 0, pendingRewards: 0 });
    }

    // Calculate pending rewards from completed-but-unclaimed missions
    const pendingMissions = await Mission.find({ operatorId, status: 'completed' });
    const pendingRewards = pendingMissions.reduce((sum, m) => sum + m.reward, 0);

    // Update wallet pending
    wallet.pendingRewards = pendingRewards;
    await wallet.save();

    // Recent reward transactions
    const recentRewards = await RewardTransaction.find({ operatorId })
      .sort({ date: -1 })
      .limit(10)
      .lean();

    res.json({
      balance: wallet.balance,
      pendingRewards: wallet.pendingRewards,
      recentRewards: recentRewards.map(r => ({
        id: r._id,
        amount: r.amount,
        reason: r.reason,
        date: r.date
      }))
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;