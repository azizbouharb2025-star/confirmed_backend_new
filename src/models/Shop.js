const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  domain: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    enum: ['shopify', 'woocommerce', 'meta', 'converty', 'tiktakpro', 'custom'],
    required: true
  },
  // Platform-specific credentials
  shopifyCredentials: {
    apiKey: String,
    apiSecret: String,
    accessToken: String,
    storeUrl: String,
    webhookSecret: String
  },
  woocommerceCredentials: {
    consumerKey: String,
    consumerSecret: String,
    storeUrl: String,
    webhookSecret: String
  },
  metaCredentials: {
    appId: String,
    appSecret: String,
    accessToken: String,
    pageId: String,
    businessId: String,
    catalogId: String
  },
  convertyCredentials: {
    apiKey: String,
    apiSecret: String,
    storeUrl: String,
    webhookSecret: String
  },
  tiktakproCredentials: {
    apiKey: String,
    apiSecret: String,
    accessToken: String,
    shopId: String,
    webhookSecret: String
  },
  customCredentials: {
    apiEndpoint: String,
    apiKey: String,
    webhookUrl: String,
    authMethod: {
      type: String,
      enum: ['api_key', 'bearer_token', 'basic_auth'],
      default: 'api_key'
    }
  },
  settings: {
    autoSync: {
      type: Boolean,
      default: true
    },
    aiCallsEnabled: {
      type: Boolean,
      default: false
    },
    callPriority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    productSyncEnabled: {
      type: Boolean,
      default: true
    },
    deliveryIntegrationEnabled: {
      type: Boolean,
      default: false
    }
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // API credentials for external integrations
  apiCredentials: {
    apiKey: {
      type: String,
      unique: true,
      sparse: true
    },
    apiSecret: {
      type: String
    },
    webhookSecret: {
      type: String
    },
    isActive: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date
    },
    lastUsed: {
      type: Date
    }
  }
}, {
  timestamps: true
});

shopSchema.index({ domain: 1 });
shopSchema.index({ subscriptionId: 1 });
shopSchema.index({ 'apiCredentials.apiKey': 1 });

module.exports = mongoose.model('Shop', shopSchema);