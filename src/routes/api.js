const express = require('express');
const shopIntegrationService = require('../services/shopIntegrationService');
const subscriptionService = require('../services/subscriptionService');
const productService = require('../services/productService');
const Order = require('../models/Order');
const Product = require('../models/Product');

const router = express.Router();

// API key authentication middleware
const apiAuth = async (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const shop = await shopIntegrationService.validateApiKey(apiKey);
    if (!shop) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.shop = shop;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// External API to create orders
router.post('/orders', apiAuth, async (req, res, next) => {
  try {
    await subscriptionService.checkLimits(req.shop._id, 'add_order');

    // Enrich items with product URLs if available
    const enrichedItems = await Promise.all(req.body.items.map(async (item) => {
      if (item.sku) {
        const product = await Product.findOne({ shopId: req.shop._id, sku: item.sku });
        return { ...item, productId: product?._id, url: product?.url };
      }
      return item;
    }));

    const order = new Order({
      ...req.body,
      items: enrichedItems,
      shopId: req.shop._id
    });

    await order.save();
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

// External API to get order status
router.get('/orders/:orderId', apiAuth, async (req, res, next) => {
  try {
    const order = await Order.findOne({
      orderId: req.params.orderId,
      shopId: req.shop._id
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

// External API to sync products
router.post('/products/sync', apiAuth, async (req, res, next) => {
  try {
    const { platform } = req.body;
    
    if (platform === 'shopify') {
      await productService.syncShopifyProducts(req.shop._id);
    } else if (platform === 'woocommerce') {
      await productService.syncWooCommerceProducts(req.shop._id);
    } else {
      return res.status(400).json({ error: 'Unsupported platform' });
    }
    
    res.json({ message: 'Products synced successfully' });
  } catch (error) {
    next(error);
  }
});

// External API to add manual product
router.post('/products', apiAuth, async (req, res, next) => {
  try {
    const product = await productService.addManualProduct(req.shop._id, req.body);
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

module.exports = router;