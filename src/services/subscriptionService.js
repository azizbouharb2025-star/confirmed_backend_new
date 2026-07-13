const Subscription = require('../models/Subscription');
const Shop = require('../models/Shop');
const User = require('../models/User');

class SubscriptionService {
  async checkLimits(shopId, action) {
    const shop = await Shop.findById(shopId).populate('subscriptionId');
    const subscription = shop.subscriptionId;

    switch (action) {
      case 'add_operator':
        if (subscription.usage.operatorsUsed >= subscription.features.maxOperators) {
          throw new Error('Operator limit reached');
        }
        break;
      
      case 'ai_call':
        if (subscription.usage.aiCallsUsed >= subscription.features.maxAICalls) {
          throw new Error('AI call limit reached');
        }
        break;
      
      case 'add_shop':
        if (subscription.usage.shopsConnected >= subscription.features.maxShops) {
          throw new Error('Shop limit reached');
        }
        break;
    }

    return true;
  }

  async updateUsage(subscriptionId, usage) {
    await Subscription.findByIdAndUpdate(subscriptionId, {
      $inc: { [`usage.${Object.keys(usage)[0]}`]: Object.values(usage)[0] }
    });
  }

  async upgradeSubscription(subscriptionId, newPlan) {
    const planFeatures = {
      free: { maxOperators: 1, maxAICalls: 10, maxShops: 1 },
      premium: { maxOperators: 5, maxAICalls: 500, maxShops: 3 },
      enterprise: { maxOperators: -1, maxAICalls: -1, maxShops: -1 }
    };

    await Subscription.findByIdAndUpdate(subscriptionId, {
      plan: newPlan,
      features: planFeatures[newPlan]
    });
  }
}

module.exports = new SubscriptionService();