const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const queueService = require('../services/queueService');
const Order = require('../models/Order');
const User = require('../models/User');
const Mission = require('../models/Mission');
const OperatorWallet = require('../models/OperatorWallet');
const RewardTransaction = require('../models/RewardTransaction');
const { logActivity } = require('../services/activityLogService');

const router = express.Router();

/*
 * Présence opérateur.
 *
 * Toute utilisation réelle d'une route /api/operators
 * actualise lastActiveAt.
 *
 * Après plus de 5 minutes sans activité, l'Admin le verra
 * automatiquement comme "Hors ligne".
 */
router.use(auth, async (req, res, next) => {
  try {
    if (req.user?.role === 'operator') {
      const now = new Date();

      const previousActivity =
        req.user.lastActiveAt
          ? new Date(req.user.lastActiveAt)
          : null;

      const wasOffline =
        !previousActivity ||
        now.getTime() - previousActivity.getTime() >
          5 * 60 * 1000;

      await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            lastActiveAt: now
          }
        }
      );

      if (wasOffline) {
        await logActivity(
          'operator',
          'Opérateur disponible',
          `${req.user.firstName} ${req.user.lastName}`
        );
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/operators/queue
 *
 * File de travail dédiée à l'opérateur connecté.
 *
 * Les commandes reportées arrivées à échéance sont
 * réactivées automatiquement avant le chargement.
 */
router.get(
  '/queue',
  auth,
  authorize('operator'),
  async (req, res, next) => {
    try {
      if (!req.user.shopId) {
        return res.status(403).json({
          error:
            'Aucune boutique associée à cet opérateur.'
        });
      }

      const result =
        await queueService.getOperatorQueue(
          req.user._id,
          req.user.shopId,
          req.query.limit || 50
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);


// Get next order for operator
router.get('/next-order', auth, authorize('operator'), async (req, res, next) => {
  try {
    const order = await queueService.assignNextOrder(
      req.user._id,
      req.user.shopId
    );
    
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
    const queueLength = await queueService.getQueueLength(
      req.user.shopId
    );
    
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

    /*
     * Avant de calculer la charge de la File,
     * réactiver les commandes reportées dont
     * l'échéance est arrivée.
     */
    await queueService.reactivateDuePostponedOrders(
      operatorId,
      req.user.shopId
    );

    /*
     * Période du dashboard opérateur.
     * Même logique fonctionnelle que le dashboard principal :
     * 7 jours / 30 jours / 90 jours.
     */
    const allowedPeriods = ['7d', '30d', '90d'];
    const requestedPeriod = String(req.query.period || '7d');
    const selectedPeriod = allowedPeriods.includes(requestedPeriod)
      ? requestedPeriod
      : '7d';

    const periodDays = {
      '7d': 7,
      '30d': 30,
      '90d': 90
    };

    const durationDays = periodDays[selectedPeriod];
    const durationMs = durationDays * 24 * 60 * 60 * 1000;

    const now = new Date();

    /*
     * Journée courante / précédente.
     * Ces bornes servent uniquement au KPI
     * "Commandes confirmées aujourd'hui".
     */
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    /*
     * Période sélectionnée et période précédente
     * de durée strictement identique.
     */
    const periodEnd = now;
    const periodStart = new Date(periodEnd.getTime() - durationMs);

    const previousPeriodEnd = periodStart;
    const previousPeriodStart = new Date(
      previousPeriodEnd.getTime() - durationMs
    );

    const makeCallHistoryMatch = (start, end, extra = {}) => ({
      assignedOperatorId: operatorId,
      callHistory: {
        $elemMatch: {
          operatorId,
          timestamp: {
            $gte: start,
            $lt: end
          },
          ...extra
        }
      }
    });

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      confirmedToday,
      confirmedYesterday,
      confirmedOrders,
      previousConfirmedOrders,
      processedOrders,
      previousProcessedOrders,
      callsToday,
      callsYesterday,
      queueCount,
      allOperatorRates
    ] = await Promise.all([
      /*
       * Nombre de COMMANDES confirmées aujourd'hui
       * par l'opérateur connecté.
       */
      Order.countDocuments(
        makeCallHistoryMatch(
          todayStart,
          tomorrowStart,
          { result: 'confirmed' }
        )
      ),

      Order.countDocuments(
        makeCallHistoryMatch(
          yesterdayStart,
          todayStart,
          { result: 'confirmed' }
        )
      ),

      /*
       * Confirmations sur la période sélectionnée.
       */
      Order.countDocuments(
        makeCallHistoryMatch(
          periodStart,
          periodEnd,
          { result: 'confirmed' }
        )
      ),

      Order.countDocuments(
        makeCallHistoryMatch(
          previousPeriodStart,
          previousPeriodEnd,
          { result: 'confirmed' }
        )
      ),

      /*
       * Une commande est considérée comme traitée si
       * l'opérateur possède au moins une activité d'appel
       * sur cette commande pendant la période.
       *
       * countDocuments compte chaque commande une seule fois,
       * même si plusieurs tentatives ont été effectuées.
       */
      Order.countDocuments(
        makeCallHistoryMatch(periodStart, periodEnd)
      ),

      Order.countDocuments(
        makeCallHistoryMatch(
          previousPeriodStart,
          previousPeriodEnd
        )
      ),

      /*
       * Compatibilité temporaire avec l'ancien frontend.
       * Ces champs seront retirés une fois le nouveau
       * dashboard validé.
       */
      Order.countDocuments(
        makeCallHistoryMatch(todayStart, tomorrowStart)
      ),

      Order.countDocuments(
        makeCallHistoryMatch(yesterdayStart, todayStart)
      ),

      /*
       * Même définition actuelle de la charge :
       * commandes disponibles + commandes déjà attribuées
       * à cet opérateur et encore à traiter.
       */
      Order.countDocuments({
        $or: [
          { status: 'pending' },
          {
            assignedOperatorId: operatorId,
            status: {
              $in: ['pending', 'assigned', 'in_progress']
            }
          }
        ]
      }),

      /*
       * Classement conservé temporairement pour ne pas
       * casser l'ancien dashboard avant le patch frontend.
       */
      Order.aggregate([
        {
          $match: {
            assignedOperatorId: { $exists: true },
            updatedAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: '$assignedOperatorId',
            total: { $sum: 1 },
            confirmed: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'confirmed'] },
                  1,
                  0
                ]
              }
            }
          }
        },
        {
          $project: {
            rate: {
              $cond: [
                { $gt: ['$total', 0] },
                {
                  $multiply: [
                    { $divide: ['$confirmed', '$total'] },
                    100
                  ]
                },
                0
              ]
            }
          }
        },
        { $sort: { rate: -1 } }
      ])
    ]);

    const confirmationRate = processedOrders > 0
      ? (confirmedOrders / processedOrders) * 100
      : 0;

    const previousConfirmationRate = previousProcessedOrders > 0
      ? (previousConfirmedOrders / previousProcessedOrders) * 100
      : 0;

    /*
     * Si la période précédente ne contient aucune donnée,
     * on renvoie null : le frontend n'affichera pas une
     * évolution artificielle de 0 %.
     */
    const calculatePercentageChange = (current, previous) => {
      if (previous <= 0) {
        return null;
      }

      return parseFloat(
        (((current - previous) / previous) * 100).toFixed(1)
      );
    };

    const confirmedTodayChange = calculatePercentageChange(
      confirmedToday,
      confirmedYesterday
    );

    const confirmedOrdersChange = calculatePercentageChange(
      confirmedOrders,
      previousConfirmedOrders
    );

    const confirmationRateChange = previousProcessedOrders > 0
      ? parseFloat(
          (
            confirmationRate - previousConfirmationRate
          ).toFixed(1)
        )
      : null;

    const callsTodayChange = calculatePercentageChange(
      callsToday,
      callsYesterday
    );

    const rankIndex = allOperatorRates.findIndex(
      (operator) =>
        operator._id &&
        operator._id.toString() === operatorId.toString()
    );

    const performanceRank = rankIndex >= 0
      ? rankIndex + 1
      : allOperatorRates.length + 1;

    res.json({
      selectedPeriod,

      // Nouveaux KPI demandés par le PDF
      confirmedToday,
      confirmedTodayChange,

      confirmedOrders,
      confirmedOrdersChange,

      confirmationRate: parseFloat(
        confirmationRate.toFixed(1)
      ),
      confirmationRateChange,

      queueLength: queueCount,

      // Compatibilité temporaire avec le dashboard actuel
      callsToday,
      callsTodayChange,
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

        // L'interface Opérateur est entièrement en français.
        // On conserve les valeurs historiques en base pour ne pas
        // casser la logique interne de progression des missions.
        title:
          m.title === 'Daily Confirmation Goal'
            ? 'Objectif quotidien de confirmation'
            : m.title === 'Call Streak'
              ? 'Objectif quotidien d\'appels'
              : m.title,

        description:
          m.description === 'Confirm 20 orders today'
            ? 'Confirmer 20 commandes aujourd\'hui'
            : m.description === 'Make 30 calls today'
              ? 'Effectuer 30 appels aujourd\'hui'
              : m.description,

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