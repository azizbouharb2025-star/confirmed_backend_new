const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const { requirePlan } = require('../middleware/planCheck');
const analyticsService = require('../services/analyticsService');

const router = express.Router();

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     summary: Get dashboard metrics for frontend widgets
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard metrics
 */
router.get('/dashboard', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const metrics = await analyticsService.getFrontendDashboardMetrics(shopId);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/risk-score-distribution:
 *   get:
 *     summary: Get AI risk score distribution (Pro+ plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/risk-score-distribution', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const distribution = await analyticsService.getRiskScoreDistribution(shopId);
    res.json(distribution);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/operator-feedback:
 *   get:
 *     summary: Get operator feedback analytics (Pro+ plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/operator-feedback', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const feedback = await analyticsService.getOperatorFeedbackAnalytics(shopId);
    res.json(feedback);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/complaints:
 *   get:
 *     summary: Get complaints analytics (Business+ plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/complaints', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const complaints = await analyticsService.getComplaintsAnalytics(shopId);
    res.json(complaints);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/courier-performance:
 *   get:
 *     summary: Get courier performance analytics (Business+ plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/courier-performance', auth, requirePlan('business'), async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const performance = await analyticsService.getCourierPerformanceAnalytics(shopId);
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/predictive:
 *   get:
 *     summary: Get predictive analytics (Enterprise plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/predictive', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const predictive = await analyticsService.getPredictiveAnalytics(shopId);
    res.json(predictive);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/automation-recommendations:
 *   get:
 *     summary: Get automation recommendations (Enterprise plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/automation-recommendations', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const recommendations = await analyticsService.getAutomationRecommendations(shopId);
    res.json(recommendations);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/call-efficiency:
 *   get:
 *     summary: Get call efficiency metrics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *     responses:
 *       200:
 *         description: Call efficiency data
 */
router.get('/call-efficiency', auth, authorize('shop_owner', 'admin'), async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const efficiency = await analyticsService.getCallEfficiency(shopId, parseInt(days));
    res.json(efficiency);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/operator-performance:
 *   get:
 *     summary: Get operator performance metrics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Operator performance data
 */
router.get('/operator-performance', auth, authorize('admin'), async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const performance = await analyticsService.getOperatorPerformance(parseInt(days));
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/revenue:
 *   get:
 *     summary: Get revenue analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue analytics data
 */
router.get('/revenue', auth, authorize('admin'), async (req, res, next) => {
  try {
    const revenue = await analyticsService.getRevenueAnalytics();
    res.json(revenue);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

/**
 * @swagger
 * /api/analytics/product-performance:
 *   get:
 *     summary: Get product performance analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/product-performance', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const performance = await analyticsService.getProductPerformanceAnalytics(shopId);
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/statistics:
 *   get:
 *     summary: Get comprehensive statistics with filters
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 */
router.get('/statistics', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      groupBy: req.query.groupBy
    };
    const statistics = await analyticsService.getStatistics(shopId, filters);
    res.json(statistics);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/ai-insights:
 *   get:
 *     summary: Get AI insights (Enterprise plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/ai-insights', auth, requirePlan('enterprise'), async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const insights = await analyticsService.getAIInsights(shopId);
    res.json(insights);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/operator-feedback-enhanced:
 *   get:
 *     summary: Get enhanced operator feedback with confidence breakdown
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/operator-feedback-enhanced', auth, async (req, res, next) => {
  try {
    const shopId = req.user.role === 'shop_owner' ? req.user.shopId : null;
    const feedback = await analyticsService.getOperatorFeedbackEnhanced(shopId);
    res.json(feedback);
  } catch (error) {
    next(error);
  }
});
