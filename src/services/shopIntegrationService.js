const axios = require('axios');
const Order = require('../models/Order');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const productService = require('./productService');

class ShopIntegrationService {
  async syncOrders(shopId) {
    const targetShop = await Shop.findById(shopId);
    
    if (targetShop.platform === 'shopify') {
      return await this.syncShopifyOrders(shopId);
    } else if (targetShop.platform === 'woocommerce') {
      return await this.syncWooCommerceOrders(shopId);
    }
    
    throw new Error(`Unsupported platform: ${targetShop.platform}`);
  }

  async syncShopifyOrders(shopId) {
    try {
      const shopifyShop = await Shop.findById(shopId);
      const { apiKey, accessToken } = shopifyShop.apiCredentials;

      const response = await axios.get(`https://${shopifyShop.domain}/admin/api/2023-10/orders.json`, {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      });

      for (const orderData of response.data.orders) {
        const existingOrder = await Order.findOne({
          orderId: orderData.id.toString(),
          shopId
        });

        if (!existingOrder) {
          const items = await Promise.all(orderData.line_items.map(async (item) => {
            const product = await Product.findOne({ 
              shopId, 
              externalId: item.product_id.toString() 
            });
            return {
              productId: product?._id,
              name: item.name,
              quantity: item.quantity,
              price: parseFloat(item.price),
              sku: item.sku,
              url: product?.url
            };
          }));

          const order = new Order({
            orderId: orderData.id.toString(),
            shopId,
            clientInfo: {
              name: `${orderData.customer.first_name} ${orderData.customer.last_name}`,
              phone: orderData.customer.phone,
              email: orderData.customer.email
            },
            items,
            totalAmount: parseFloat(orderData.total_price)
          });

          await order.save();

          // Add to queue
          const redis = getRedisClient();
          await redis.lPush('call_queue', JSON.stringify({
            orderId: order._id,
            shopId,
            priority: shopifyShop.settings.callPriority,
            timestamp: new Date()
          }));
        }
      }

      // Sync products if enabled
      if (shopifyShop.settings.productSyncEnabled) {
        await productService.syncShopifyProducts(shopId);
      }

      logger.info(`Synced orders for shop ${shopId}`);
    } catch (error) {
      logger.error(`Failed to sync orders for shop ${shopId}:`, error);
    }
  }

  async syncWooCommerceOrders(shopId) {
    try {
      const wooShop = await Shop.findById(shopId);
      const { consumerKey, consumerSecret, storeUrl } = wooShop.apiCredentials;

      const response = await axios.get(`${storeUrl}/wp-json/wc/v3/orders`, {
        auth: { username: consumerKey, password: consumerSecret }
      });

      for (const orderData of response.data) {
        const existingOrder = await Order.findOne({
          orderId: orderData.id.toString(),
          shopId
        });

        if (!existingOrder) {
          const items = await Promise.all(orderData.line_items.map(async (item) => {
            const product = await Product.findOne({ 
              shopId, 
              externalId: item.product_id.toString() 
            });
            return {
              productId: product?._id,
              name: item.name,
              quantity: item.quantity,
              price: parseFloat(item.price),
              sku: item.sku,
              url: product?.url
            };
          }));

          const order = new Order({
            orderId: orderData.id.toString(),
            shopId,
            clientInfo: {
              name: `${orderData.billing.first_name} ${orderData.billing.last_name}`,
              phone: orderData.billing.phone,
              email: orderData.billing.email
            },
            items,
            totalAmount: parseFloat(orderData.total)
          });

          await order.save();

          const redis = getRedisClient();
          await redis.lPush('call_queue', JSON.stringify({
            orderId: order._id,
            shopId,
            priority: wooShop.settings.callPriority,
            timestamp: new Date()
          }));
        }
      }

      // Sync products if enabled
      if (wooShop.settings.productSyncEnabled) {
        await productService.syncWooCommerceProducts(shopId);
      }

      logger.info(`Synced WooCommerce orders for shop ${shopId}`);
    } catch (error) {
      logger.error(`Failed to sync WooCommerce orders for shop ${shopId}:`, error);
    }
  }

  async generateApiKey(shopId) {
    const apiKey = require('crypto').randomBytes(32).toString('hex');
    await Shop.findByIdAndUpdate(shopId, {
      'apiCredentials.apiKey': apiKey
    });
    return apiKey;
  }

  async validateApiKey(apiKey) {
    const foundShop = await Shop.findOne({ 'apiCredentials.apiKey': apiKey });
    return foundShop;
  }
}

module.exports = new ShopIntegrationService();