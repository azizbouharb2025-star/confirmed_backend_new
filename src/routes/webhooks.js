const express = require('express');
const crypto = require('crypto');
const Order = require('../models/Order');
const Shop = require('../models/Shop');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const router = express.Router();

// Verify Shopify webhook signature
const verifyShopifyWebhook = (req, res, next) => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const shopDomain = req.get('X-Shopify-Shop-Domain');
  
  if (!hmacHeader || !shopDomain) {
    logger.warn('Shopify webhook missing required headers');
    return res.status(401).json({ error: 'Missing webhook headers' });
  }

  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);
  
  // In production, verify against shop's webhook secret
  // For now, we'll verify the shop exists and log the attempt
  Shop.findOne({ domain: shopDomain }).then(shop => {
    if (!shop) {
      logger.warn(`Webhook received for unknown shop: ${shopDomain}`);
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // If shop has webhook secret configured, verify signature
    if (shop.shopifyCredentials?.webhookSecret) {
      const calculatedHmac = crypto
        .createHmac('sha256', shop.shopifyCredentials.webhookSecret)
        .update(rawBody, 'utf8')
        .digest('base64');
      
      if (calculatedHmac !== hmacHeader) {
        logger.warn(`Invalid webhook signature for shop: ${shopDomain}`);
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }
    
    req.shop = shop;
    next();
  }).catch(err => {
    logger.error('Webhook verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  });
};

// Shopify webhook for new orders
router.post('/shopify/orders', verifyShopifyWebhook, async (req, res, next) => {
  try {
    const shop = req.shop;

    const orderData = req.body;
    
    const order = new Order({
      orderId: orderData.id.toString(),
      shopId: shop._id,
      clientInfo: {
        name: `${orderData.customer.first_name} ${orderData.customer.last_name}`,
        phone: orderData.customer.phone,
        email: orderData.customer.email,
        address: orderData.shipping_address
      },
      items: orderData.line_items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: parseFloat(item.price),
        sku: item.sku
      })),
      totalAmount: parseFloat(orderData.total_price)
    });

    await order.save();

    // Add to call queue if Redis is available
    const redis = getRedisClient();
    if (redis) {
      await redis.lPush('call_queue', JSON.stringify({
        orderId: order._id,
        shopId: order.shopId,
        priority: shop.settings?.callPriority || 'medium',
        timestamp: new Date()
      }));
    }

    logger.info(`New order received from ${shop.domain}: ${order.orderId}`);
    res.status(200).json({ message: 'Order processed' });
  } catch (error) {
    next(error);
  }
});

// Generic webhook for order status updates (requires API key auth)
router.post('/order-status', async (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const { orderId, shopId, status, deliveryInfo } = req.body;

    // Verify API key belongs to the shop
    const shop = await Shop.findOne({
      _id: shopId,
      'apiCredentials.apiKey': apiKey,
      'apiCredentials.isActive': true
    });

    if (!shop) {
      return res.status(401).json({ error: 'Invalid API key or shop' });
    }

    const order = await Order.findOneAndUpdate(
      { orderId, shopId },
      { 
        status,
        ...(deliveryInfo && { deliveryInfo })
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: 'Order status updated' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;