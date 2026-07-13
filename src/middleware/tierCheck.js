/**
 * Tier Check Middleware
 * 
 * Provides tier-based feature gating and filter application for the Orders API.
 * Tiers: free, pro, business, enterprise (in ascending order of features)
 * 
 * Tier mapping from subscription plans:
 * - 'free' -> free tier
 * - 'premium' -> pro tier  
 * - 'business' -> business tier
 * - 'enterprise' -> enterprise tier
 */

const Shop = require('../models/Shop');
const Subscription = require('../models/Subscription');

// Tier hierarchy (higher index = more features)
const TIER_HIERARCHY = ['free', 'pro', 'business', 'enterprise'];

// Map subscription plans to tier names
const PLAN_TO_TIER = {
  'free': 'free',
  'starter': 'pro',
  'pro': 'pro',
  'premium': 'pro',
  'business': 'business',
  'enterprise': 'enterprise'
};

// Features available at each tier level (cumulative - higher tiers include lower tier features)
const TIER_FEATURES = {
  free: [],
  pro: ['aiRiskScore', 'operatorFeedback'],
  business: ['aiRiskScore', 'operatorFeedback', 'region', 'courier', 'courierAssignment', 'complaintFlags'],
  enterprise: ['aiRiskScore', 'operatorFeedback', 'region', 'courier', 'courierAssignment', 'complaintFlags', 'isRepeatBuyer', 'customerLifetimeValue']
};

/**
 * Get the tier name for a user based on their shop's subscription
 * @param {Object} user - User object with shopId
 * @returns {Promise<string>} Tier name ('free', 'pro', 'business', 'enterprise')
 */
async function getUserTier(user) {
  if (!user || !user.shopId) {
    return 'free';
  }

  try {
    const shop = await Shop.findById(user.shopId).populate('subscriptionId');
    
    if (!shop || !shop.subscriptionId) {
      return 'free';
    }

    const subscription = shop.subscriptionId;
    const plan = subscription.plan || 'free';
    
    return PLAN_TO_TIER[plan] || 'free';
  } catch (error) {
    return 'free';
  }
}


/**
 * Get the tier name synchronously from a pre-loaded subscription/shop
 * @param {Object} subscription - Subscription object with plan field
 * @returns {string} Tier name
 */
function getTierFromSubscription(subscription) {
  if (!subscription || !subscription.plan) {
    return 'free';
  }
  return PLAN_TO_TIER[subscription.plan] || 'free';
}

/**
 * Check if a tier has access to a specific feature
 * @param {string} tier - Tier name
 * @param {string} feature - Feature name
 * @returns {boolean} True if tier has access to feature
 */
function tierHasFeature(tier, feature) {
  const tierFeatures = TIER_FEATURES[tier] || [];
  return tierFeatures.includes(feature);
}

/**
 * Check if a tier meets or exceeds a minimum tier level
 * @param {string} userTier - User's tier
 * @param {string} requiredTier - Minimum required tier
 * @returns {boolean} True if user tier meets requirement
 */
function tierMeetsMinimum(userTier, requiredTier) {
  const userIndex = TIER_HIERARCHY.indexOf(userTier);
  const requiredIndex = TIER_HIERARCHY.indexOf(requiredTier);
  return userIndex >= requiredIndex;
}

/**
 * Middleware factory to check if user has access to a tier-specific feature
 * @param {string} feature - Feature name to check
 * @returns {Function} Express middleware
 */
function checkTierFeature(feature) {
  return async (req, res, next) => {
    try {
      const tier = await getUserTier(req.user);
      
      if (!tierHasFeature(tier, feature)) {
        return res.status(403).json({
          error: 'Feature not available',
          code: 'TIER_FEATURE_UNAVAILABLE',
          details: {
            feature,
            currentTier: tier,
            requiredTier: getMinimumTierForFeature(feature)
          }
        });
      }
      
      req.userTier = tier;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Get the minimum tier required for a feature
 * @param {string} feature - Feature name
 * @returns {string} Minimum tier name
 */
function getMinimumTierForFeature(feature) {
  for (const tier of TIER_HIERARCHY) {
    if (TIER_FEATURES[tier]?.includes(feature)) {
      return tier;
    }
  }
  return 'enterprise';
}

/**
 * Apply tier-specific filters to query parameters
 * Filters out tier-specific parameters that the user doesn't have access to
 * 
 * @param {string} tier - User's tier
 * @param {Object} query - Query parameters from request
 * @returns {Object} Filtered query parameters with only allowed tier filters
 */
function getTierFilters(tier, query) {
  const filteredQuery = { ...query };
  
  // Pro+ tier filters: aiScoreMin, aiScoreMax
  if (!tierMeetsMinimum(tier, 'pro')) {
    delete filteredQuery.aiScoreMin;
    delete filteredQuery.aiScoreMax;
  }
  
  // Business+ tier filters: region, courier
  if (!tierMeetsMinimum(tier, 'business')) {
    delete filteredQuery.region;
    delete filteredQuery.courier;
  }
  
  return filteredQuery;
}

/**
 * Middleware to apply tier-based query filtering
 * Attaches filtered query to req.tierFilteredQuery
 * @returns {Function} Express middleware
 */
function applyTierFilters() {
  return async (req, res, next) => {
    try {
      const tier = req.userTier || await getUserTier(req.user);
      req.userTier = tier;
      req.tierFilteredQuery = getTierFilters(tier, req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  getUserTier,
  getTierFromSubscription,
  tierHasFeature,
  tierMeetsMinimum,
  checkTierFeature,
  getMinimumTierForFeature,
  getTierFilters,
  applyTierFilters,
  TIER_HIERARCHY,
  TIER_FEATURES,
  PLAN_TO_TIER
};
