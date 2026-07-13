const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  plan: {
    type: String,
    enum: ['free', 'starter', 'pro', 'business', 'enterprise', 'premium'],
    required: true
  },
  features: {
    maxOperators: {
      type: Number,
      required: true
    },
    maxAICalls: {
      type: Number,
      required: true
    },
    maxShops: {
      type: Number,
      required: true
    },
    prioritySupport: {
      type: Boolean,
      default: false
    },
    customIntegrations: {
      type: Boolean,
      default: false
    },
    widgets: {
      type: [String],
      default: ['kpi-basic', 'recent-orders']
    },
    advancedAnalytics: {
      type: Boolean,
      default: false
    },
    predictiveAnalytics: {
      type: Boolean,
      default: false
    }
  },
  pricing: {
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'USD'
    },
    interval: {
      type: String,
      enum: ['monthly', 'yearly'],
      required: true
    }
  },
  stripeProductId: String,
  stripePriceId: String,
  status: {
    type: String,
    enum: ['active', 'cancelled', 'past_due'],
    default: 'active'
  },
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  usage: {
    operatorsUsed: {
      type: Number,
      default: 0
    },
    aiCallsUsed: {
      type: Number,
      default: 0
    },
    shopsConnected: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

subscriptionSchema.index({ plan: 1 });
subscriptionSchema.index({ status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);