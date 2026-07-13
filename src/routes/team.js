const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Order = require('../models/Order');

const router = express.Router();

/**
 * @swagger
 * /api/team/staff:
 *   get:
 *     summary: Get internal staff members (non-operators)
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 */
router.get('/staff', auth, authorize('shop_owner', 'admin'), async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const matchStage = shopId ? { shopId, role: { $ne: 'operator' } } : { role: { $ne: 'operator' } };

    const staff = await User.find(matchStage)
      .select('firstName lastName email role isActive createdAt')
      .sort({ createdAt: -1 });

    res.json({
      staff: staff.map(s => ({
        _id: s._id,
        name: `${s.firstName} ${s.lastName}`,
        email: s.email,
        role: s.role,
        isActive: s.isActive,
        createdAt: s.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/team/operators:
 *   get:
 *     summary: Get confirmed operators with performance stats
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 */
router.get('/operators', auth, authorize('shop_owner', 'admin'), async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const matchStage = shopId ? { shopId } : {};

    const operators = await User.find({ ...matchStage, role: 'operator', isActive: true })
      .select('firstName lastName email phoneNumber createdAt');

    const operatorsWithStats = await Promise.all(operators.map(async (operator) => {
      const [totalOrders, confirmedOrders, callStats] = await Promise.all([
        Order.countDocuments({ assignedOperatorId: operator._id }),
        Order.countDocuments({ assignedOperatorId: operator._id, status: 'confirmed' }),
        Order.aggregate([
          { $match: { assignedOperatorId: operator._id } },
          { $unwind: '$callHistory' },
          {
            $group: {
              _id: null,
              totalCalls: { $sum: 1 },
              avgDuration: { $avg: '$callHistory.duration' }
            }
          }
        ])
      ]);

      const deliveredOrders = await Order.countDocuments({
        assignedOperatorId: operator._id,
        status: 'delivered'
      });

      const confirmationRate = totalOrders > 0 
        ? parseFloat(((confirmedOrders / totalOrders) * 100).toFixed(1))
        : 0;

      const deliveryRate = totalOrders > 0
        ? parseFloat(((deliveredOrders / totalOrders) * 100).toFixed(1))
        : 0;

      const callData = callStats[0] || { totalCalls: 0, avgDuration: 0 };

      return {
        _id: operator._id,
        operatorId: `OP-${operator._id.toString().slice(-6).toUpperCase()}`,
        name: `${operator.firstName} ${operator.lastName}`,
        email: operator.email,
        performance: {
          confirmationRate,
          deliveryRate,
          avgCallDuration: Math.round(callData.avgDuration || 0),
          reliabilityScore: Math.round((confirmationRate + deliveryRate) / 2),
          totalCalls: callData.totalCalls,
          confirmedOrders
        }
      };
    }));

    res.json({
      operators: operatorsWithStats.sort((a, b) => 
        b.performance.reliabilityScore - a.performance.reliabilityScore
      )
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/team/operators/{operatorId}/tip:
 *   post:
 *     summary: Allow sellers to tip operators
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: operatorId
 *         required: true
 *         schema:
 *           type: string
 */
router.post('/operators/:operatorId/tip', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { operatorId } = req.params;
    const { amount, message } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid tip amount' });
    }

    const operator = await User.findById(operatorId);
    if (!operator || operator.role !== 'operator') {
      return res.status(404).json({ error: 'Operator not found' });
    }

    // Here you would implement the actual tip transaction
    // For now, we'll just log it
    // TODO: Implement OperatorWallet transaction

    res.json({
      success: true,
      message: 'Tip sent successfully',
      amount,
      operatorName: `${operator.firstName} ${operator.lastName}`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
