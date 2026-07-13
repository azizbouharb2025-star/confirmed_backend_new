/**
 * Middleware to check subscription plan requirements
 */

const Subscription = require('../models/Subscription');

const planHierarchy = {
  starter: 0,
  pro: 1,
  business: 2,
  enterprise: 3
};

/**
 * Require a minimum subscription plan to access a route
 * @param {string} minPlan - Minimum required plan (starter, pro, business, enterprise)
 */
function requirePlan(minPlan) {
  return async (req, res, next) => {
    try {
      // Admin users bypass plan checks
      if (req.user.role === 'admin') {
        return next();
      }

      // Get user's subscription
      const subscription = await Subscription.findById(req.user.subscriptionId);
      
      if (!subscription) {
        return res.status(403).json({ 
          error: 'No active subscription',
          requiredPlan: minPlan,
          currentPlan: 'none'
        });
      }

      const userPlan = subscription.plan;
      const userPlanLevel = planHierarchy[userPlan] || 0;
      const requiredPlanLevel = planHierarchy[minPlan] || 0;

      if (userPlanLevel >= requiredPlanLevel) {
        return next();
      }

      return res.status(403).json({ 
        error: 'Upgrade required',
        message: `This feature requires ${minPlan} plan or higher`,
        requiredPlan: minPlan,
        currentPlan: userPlan
      });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Check if user has access to a specific feature
 * @param {string} feature - Feature name
 */
function hasFeature(feature) {
  const featurePlans = {
    'ai_insights': 'enterprise',
    'courier_tracking': 'business',
    'advanced_analytics': 'business',
    'operator_tips': 'pro',
    'ai_scoring': 'pro',
    'complaint_management': 'business'
  };

  const requiredPlan = featurePlans[feature] || 'starter';
  return requirePlan(requiredPlan);
}

module.exports = {
  requirePlan,
  hasFeature,
  planHierarchy
};
