const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../models/Subscription');
const Shop = require('../models/Shop');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Plan feature definitions
const PLAN_FEATURES = {
  starter: {
    widgets: ['kpi-basic', 'recent-orders'],
    maxOperators: 5,
    maxAICalls: 100,
    advancedAnalytics: false,
    predictiveAnalytics: false
  },
  pro: {
    widgets: ['kpi-basic', 'recent-orders', 'risk-score', 'operator-feedback'],
    maxOperators: 15,
    maxAICalls: 500,
    advancedAnalytics: true,
    predictiveAnalytics: false
  },
  business: {
    widgets: ['kpi-basic', 'recent-orders', 'risk-score', 'operator-feedback', 'complaints', 'courier-performance'],
    maxOperators: 50,
    maxAICalls: 2000,
    advancedAnalytics: true,
    predictiveAnalytics: false
  },
  enterprise: {
    widgets: ['kpi-basic', 'recent-orders', 'risk-score', 'operator-feedback', 'complaints', 'courier-performance', 'predictive', 'automation'],
    maxOperators: -1,
    maxAICalls: -1,
    advancedAnalytics: true,
    predictiveAnalytics: true
  }
};

/**
 * GET /api/subscriptions/current
 * Get current user's subscription with features
 */
router.get('/current', auth, async (req, res, next) => {
  try {
    let subscription = null;
    
    // Get subscription from shop if user has one
    if (req.user.shopId) {
      const shop = await Shop.findById(req.user.shopId).populate('subscriptionId');
      subscription = shop?.subscriptionId;
    }
    
    // Default to starter plan if no subscription
    const plan = subscription?.plan || 'starter';
    const features = PLAN_FEATURES[plan] || PLAN_FEATURES.starter;
    
    res.json({
      plan,
      features: {
        widgets: features.widgets,
        maxOperators: features.maxOperators,
        maxAICalls: features.maxAICalls,
        advancedAnalytics: features.advancedAnalytics,
        predictiveAnalytics: features.predictiveAnalytics
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get subscription plans
router.get('/plans', async (req, res, next) => {
  try {
    const plans = [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        features: {
          maxOperators: 1,
          maxAICalls: 10,
          maxShops: 1,
          prioritySupport: false,
          customIntegrations: false
        }
      },
      {
        id: 'premium',
        name: 'Premium',
        price: 49,
        features: {
          maxOperators: 5,
          maxAICalls: 500,
          maxShops: 3,
          prioritySupport: true,
          customIntegrations: false
        }
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 199,
        features: {
          maxOperators: -1,
          maxAICalls: -1,
          maxShops: -1,
          prioritySupport: true,
          customIntegrations: true
        }
      }
    ];

    res.json(plans);
  } catch (error) {
    next(error);
  }
});

// Create subscription
router.post('/create', auth, async (req, res, next) => {
  try {
    const { plan, paymentMethodId } = req.body;

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: req.user.email,
      payment_method: paymentMethodId,
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Create subscription in Stripe
    const stripeSubscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: `price_${plan}` }],
      expand: ['latest_invoice.payment_intent'],
    });

    // Create subscription in database
    const subscription = new Subscription({
      plan,
      stripeProductId: stripeSubscription.items.data[0].price.product,
      stripePriceId: stripeSubscription.items.data[0].price.id,
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      status: stripeSubscription.status
    });

    await subscription.save();

    res.json({
      subscription,
      clientSecret: stripeSubscription.latest_invoice.payment_intent.client_secret
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;