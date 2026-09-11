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
    
    if (targetShop.platform === 'converty') {
      return await this.syncConvertyOrders(shopId);
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

  async syncConvertyOrders(shopId) {
    const shop = await Shop.findById(shopId);

    if (!shop) {
      throw new Error(`Shop not found: ${shopId}`);
    }

    const accessToken =
      shop.convertyCredentials?.accessToken;

    if (!accessToken) {
      throw new Error(
        `Converty access token missing for shop ${shopId}`
      );
    }

    let page = 1;
    const limit = 50;

    let fetched = 0;
    let created = 0;
    let skipped = 0;

    const toNumber = (value, fallback = 0) => {
      const parsed = Number(value);

      return Number.isFinite(parsed)
        ? parsed
        : fallback;
    };

    while (page <= 100) {
      const response = await axios.get(
        'https://api.converty.shop/api/v1/orders',
        {
          params: {
              page,
              limit,
              status: 'pending'
            },
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
            Accept:
              'application/json'
          },
          timeout: 15000
        }
      );

      const root =
        response.data || {};

      const payload =
        root.data;

      const orders =
        Array.isArray(payload)
          ? payload
          : payload?.orders ||
            payload?.items ||
            payload?.docs ||
            [];

      if (!Array.isArray(orders)) {
        throw new Error(
          'Unexpected Converty orders response'
        );
      }

      fetched += orders.length;

      for (const source of orders) {
        const orderId =
          source?._id
            ? String(source._id)
            : source?.reference != null
              ? String(source.reference)
              : null;

        if (!orderId) {
          skipped += 1;
          continue;
        }

        const exists =
          await Order.exists({
            shopId,
            orderId
          });

        if (exists) {
          skipped += 1;
          continue;
        }

        const cart =
          Array.isArray(source.cart)
            ? source.cart
            : [];

        const items =
          cart.map(entry => {
            const product =
              entry?.product || {};

            return {
              name:
                product.name ||
                'Produit Converty',

              quantity:
                Math.max(
                  1,
                  toNumber(
                    entry?.quantity,
                    1
                  )
                ),

              price:
                toNumber(
                  entry?.pricePerUnit,
                  toNumber(
                    product.price,
                    0
                  )
                ),

              sku:
                product.sku ||
                undefined
            };
          });

        const calculatedTotal =
          items.reduce(
            (sum, item) =>
              sum +
              (
                item.price *
                item.quantity
              ),
            0
          );

        const totalAmount =
          toNumber(
            source?.total?.totalPrice,
            calculatedTotal
          );

        const order =
          new Order({
            shopId,
            orderId,

            clientInfo: {
              name:
                source?.customer?.name ||
                'Client Converty',

              phone:
                source?.customer?.phone ||
                ''
            },

            items,
            totalAmount
          });

        await order.save();

        const redis =
          getRedisClient();

        if (redis) {
          await redis.lPush(
            'call_queue',
            JSON.stringify({
              orderId:
                order._id,

              shopId,

              priority:
                shop.settings
                  ?.callPriority ||
                'medium',

              timestamp:
                new Date()
            })
          );
        }

        created += 1;
      }

      const total =
        Number(root.count);

      if (
        orders.length === 0 ||
        orders.length < limit ||
        (
          Number.isFinite(total) &&
          fetched >= total
        )
      ) {
        break;
      }

      page += 1;
    }

    logger.info(
      `Converty sync ${shopId}: ` +
      `${fetched} fetched, ` +
      `${created} created, ` +
      `${skipped} skipped`
    );

    return {
      fetched,
      created,
      skipped
    };
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