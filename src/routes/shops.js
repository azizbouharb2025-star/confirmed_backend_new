const express = require('express');
const Joi = require('joi');
const Shop = require('../models/Shop');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

const createShopSchema = Joi.object({
  name: Joi.string().required(),
  domain: Joi.string().required(),
  platform: Joi.string().valid('shopify', 'woocommerce', 'meta', 'converty', 'tiktakpro', 'custom').required(),
  shopifyCredentials: Joi.object({
    apiKey: Joi.string(),
    apiSecret: Joi.string(),
    accessToken: Joi.string(),
    storeUrl: Joi.string(),
    webhookSecret: Joi.string()
  }),
  woocommerceCredentials: Joi.object({
    consumerKey: Joi.string(),
    consumerSecret: Joi.string(),
    storeUrl: Joi.string(),
    webhookSecret: Joi.string()
  }),
  metaCredentials: Joi.object({
    appId: Joi.string(),
    appSecret: Joi.string(),
    accessToken: Joi.string(),
    pageId: Joi.string(),
    businessId: Joi.string(),
    catalogId: Joi.string()
  }),
  convertyCredentials: Joi.object({
    apiKey: Joi.string(),
    apiSecret: Joi.string(),
    storeUrl: Joi.string(),
    webhookSecret: Joi.string()
  }),
  tiktakproCredentials: Joi.object({
    apiKey: Joi.string(),
    apiSecret: Joi.string(),
    accessToken: Joi.string(),
    shopId: Joi.string(),
    webhookSecret: Joi.string()
  }),
  customCredentials: Joi.object({
    apiEndpoint: Joi.string(),
    apiKey: Joi.string(),
    webhookUrl: Joi.string(),
    authMethod: Joi.string().valid('api_key', 'bearer_token', 'basic_auth')
  })
});

// Create shop
router.post('/', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { error } = createShopSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { platform } = req.body;

    // Validate platform-specific credentials
    const credentialField = `${platform}Credentials`;
    if (!req.body[credentialField]) {
      return res.status(400).json({ 
        error: `${platform} credentials are required for this platform` 
      });
    }

    // Create default subscription for new shop
    const subscription = new (require('../models/Subscription'))({
      plan: 'free',
      features: {
        maxOperators: 1,
        maxAICalls: 10,
        maxShops: 1,
        prioritySupport: false,
        customIntegrations: false
      },
      pricing: {
        amount: 0,
        currency: 'USD',
        interval: 'monthly'
      }
    });
    await subscription.save();

    const shop = new Shop({
      ...req.body,
      subscriptionId: subscription._id
    });

    await shop.save();

    // Link shop to user
    await require('../models/User').findByIdAndUpdate(req.user._id, {
      shopId: shop._id
    });

    res.status(201).json({
      message: 'Shop created successfully',
      shop,
      nextSteps: getNextSteps(platform)
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to provide next steps based on platform
function getNextSteps(platform) {
  const steps = {
    shopify: [
      'Install Confirmed app from Shopify App Store',
      'Configure webhook endpoints',
      'Test order synchronization'
    ],
    woocommerce: [
      'Install Confirmed plugin',
      'Configure API endpoints',
      'Set up webhook notifications'
    ],
    meta: [
      'Connect Facebook Business Manager',
      'Configure catalog sync',
      'Set up Instagram Shopping'
    ],
    converty: [
      'Generate API credentials in Converty dashboard',
      'Configure webhook endpoints',
      'Test order synchronization'
    ],
    tiktakpro: [
      'Connect your TiktakPro seller account',
      'Configure shop and product sync',
      'Set up order webhook notifications'
    ],
    custom: [
      'Implement API endpoints',
      'Configure webhook handlers',
      'Test integration'
    ]
  };
  return steps[platform] || [];
}

// Get shops
router.get('/', auth, async (req, res, next) => {
  try {
    const query = req.user.role === 'admin' ? {} : { _id: req.user.shopId };
    const shops = await Shop.find(query).populate('subscriptionId');
    res.json(shops);
  } catch (error) {
    next(error);
  }
});

// Update shop credentials
router.patch('/:id/credentials', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { platform, credentials } = req.body;
    const credentialField = `${platform}Credentials`;
    
    const updateData = {};
    updateData[credentialField] = credentials;

    const shop = await Shop.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json({ message: 'Credentials updated successfully', shop });
  } catch (error) {
    next(error);
  }
});

// Update shop settings
router.patch('/:id/settings', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { settings } = req.body;
    const shop = await Shop.findByIdAndUpdate(
      req.params.id,
      { settings },
      { new: true }
    );

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json(shop);
  } catch (error) {
    next(error);
  }
});

// Generate API credentials for shop integration
router.post('/:id/generate-credentials', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Verify user owns this shop
    if (req.user.shopId.toString() !== id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const crypto = require('crypto');
    
    const apiKey = `ck_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = `cs_${crypto.randomBytes(32).toString('hex')}`;
    const webhookSecret = `wh_${crypto.randomBytes(24).toString('hex')}`;

    const shop = await Shop.findByIdAndUpdate(
      id,
      {
        'apiCredentials.apiKey': apiKey,
        'apiCredentials.apiSecret': apiSecret,
        'apiCredentials.webhookSecret': webhookSecret,
        'apiCredentials.isActive': true,
        'apiCredentials.createdAt': new Date()
      },
      { new: true }
    );

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json({
      message: 'API credentials generated successfully',
      credentials: {
        apiKey: shop.apiCredentials.apiKey,
        apiSecret: shop.apiCredentials.apiSecret,
        webhookSecret: shop.apiCredentials.webhookSecret,
        webhookUrl: `${process.env.API_BASE_URL}/api/webhooks/shop/${id}`,
        apiEndpoint: `${process.env.API_BASE_URL}/api/integration/shop/${id}`
      },
      documentation: {
        authentication: 'Use API Key and Secret for Basic Auth or Bearer token',
        endpoints: {
          orders: `GET ${process.env.API_BASE_URL}/api/integration/shop/${id}/orders`,
          products: `GET ${process.env.API_BASE_URL}/api/integration/shop/${id}/products`,
          webhooks: `POST ${process.env.API_BASE_URL}/api/webhooks/shop/${id}`
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get current API credentials
router.get('/:id/credentials', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Verify user owns this shop
    if (req.user.shopId.toString() !== id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const shop = await Shop.findById(id).select('apiCredentials name');
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.apiCredentials.apiKey) {
      return res.json({ 
        message: 'No API credentials generated yet',
        hasCredentials: false
      });
    }

    // Don't expose apiSecret in GET response
    res.json({
      hasCredentials: true,
      credentials: {
        apiKey: shop.apiCredentials.apiKey,
        webhookUrl: `${process.env.API_BASE_URL}/api/webhooks/shop/${id}`,
        apiEndpoint: `${process.env.API_BASE_URL}/api/integration/shop/${id}`,
        isActive: shop.apiCredentials.isActive,
        createdAt: shop.apiCredentials.createdAt,
        lastUsed: shop.apiCredentials.lastUsed
      }
    });
  } catch (error) {
    next(error);
  }
});

// Revoke API credentials
router.delete('/:id/credentials', auth, authorize('shop_owner'), async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Verify user owns this shop
    if (req.user.shopId.toString() !== id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await Shop.findByIdAndUpdate(id, {
      'apiCredentials.isActive': false
    });

    res.json({ message: 'API credentials revoked successfully' });
  } catch (error) {
    next(error);
  }
});

// Get platform requirements
router.get('/platform-requirements/:platform', (req, res) => {
  const { platform } = req.params;
  
  const requirements = {
    shopify: {
      required: ['apiKey', 'apiSecret', 'storeUrl'],
      optional: ['accessToken', 'webhookSecret'],
      description: 'Connect your Shopify store using private app credentials'
    },
    woocommerce: {
      required: ['consumerKey', 'consumerSecret', 'storeUrl'],
      optional: ['webhookSecret'],
      description: 'Connect using WooCommerce REST API credentials'
    },
    meta: {
      required: ['appId', 'appSecret', 'pageId'],
      optional: ['businessId', 'catalogId', 'accessToken'],
      description: 'Connect your Facebook/Instagram business account'
    },
    converty: {
      required: ['apiKey', 'apiSecret', 'storeUrl'],
      optional: ['webhookSecret'],
      description: 'Connect your Converty e-commerce store'
    },
    tiktakpro: {
      required: ['apiKey', 'apiSecret', 'shopId'],
      optional: ['accessToken', 'webhookSecret'],
      description: 'Connect your TiktakPro seller account'
    },
    custom: {
      required: ['apiEndpoint', 'apiKey'],
      optional: ['webhookUrl', 'authMethod'],
      description: 'Connect your custom e-commerce platform'
    }
  };

  if (!requirements[platform]) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  res.json(requirements[platform]);
});

module.exports = router;