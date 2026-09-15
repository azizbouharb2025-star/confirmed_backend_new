const axios = require('axios');
const Order = require('../models/Order');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const productService = require('./productService');

const CONVERTY_TOKEN_URL =
  'https://partner.converty.shop/oauth2/token';

const CONVERTY_REFRESH_LEEWAY_MS =
  5 * 60 * 1000;

const CONVERTY_RATE_LIMIT_KEY =
  'confirmed:converty:rate-limit-cooldown';

const CONVERTY_RATE_LIMIT_FALLBACK_SECONDS =
  15 * 60;

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

  async getConvertyAccessToken(shop) {
    const credentials =
      shop.convertyCredentials || {};

    const accessToken =
      credentials.accessToken;

    const expiresAtMs =
      credentials.expiresAt
        ? new Date(credentials.expiresAt).getTime()
        : null;

    const expiresSoon =
      Number.isFinite(expiresAtMs) &&
      expiresAtMs <=
        Date.now() +
        CONVERTY_REFRESH_LEEWAY_MS;

    if (
      accessToken &&
      !expiresSoon
    ) {
      return accessToken;
    }

    const refreshToken =
      credentials.refreshToken;

    if (!refreshToken) {
      const error =
        new Error(
          'Converty reconnect required'
        );

      error.code =
        'CONVERTY_RECONNECT_REQUIRED';

      throw error;
    }

    const clientId =
      process.env.CONVERTY_CLIENT_ID;

    const clientSecret =
      process.env.CONVERTY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Converty OAuth configuration missing'
      );
    }

    const form =
      new URLSearchParams({
        grant_type:
          'refresh_token',

        refresh_token:
          refreshToken,

        client_id:
          clientId,

        client_secret:
          clientSecret
      });

    const response =
      await axios.post(
        CONVERTY_TOKEN_URL,
        form.toString(),
        {
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },

          timeout:
            15000,

          validateStatus:
            () => true
        }
      );

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      const error =
        new Error(
          'Converty token refresh failed'
        );

      error.code =
        'CONVERTY_TOKEN_REFRESH_FAILED';

      error.status =
        response.status;

      throw error;
    }

    const tokenData =
      response.data?.data ||
      response.data ||
      {};

    const nextAccessToken =
      tokenData.access_token ||
      tokenData.accessToken ||
      tokenData.token;

    if (!nextAccessToken) {
      throw new Error(
        'Converty refresh response has no access token'
      );
    }

    const nextRefreshToken =
      tokenData.refresh_token ||
      tokenData.refreshToken ||
      null;

    const expiresIn =
      Number(
        tokenData.expires_in ||
        tokenData.expiresIn ||
        0
      );

    const setUpdate = {
      'convertyCredentials.accessToken':
        nextAccessToken
    };

    if (nextRefreshToken) {
      setUpdate[
        'convertyCredentials.refreshToken'
      ] =
        nextRefreshToken;
    }

    if (
      tokenData.token_type ||
      tokenData.tokenType
    ) {
      setUpdate[
        'convertyCredentials.tokenType'
      ] =
        tokenData.token_type ||
        tokenData.tokenType;
    }

    if (expiresIn > 0) {
      setUpdate[
        'convertyCredentials.expiresAt'
      ] =
        new Date(
          Date.now() +
          expiresIn * 1000
        );
    }

    const update = {
      $set:
        setUpdate
    };

    if (!(expiresIn > 0)) {
      update.$unset = {
        'convertyCredentials.expiresAt':
          1
      };
    }

    await Shop.updateOne(
      {
        _id:
          shop._id
      },
      update
    );

    logger.info(
      'Converty OAuth token refreshed',
      {
        shopId:
          String(shop._id)
      }
    );

    return nextAccessToken;
  }

  async syncConvertyOrderStatus(
    shopId,
    externalOrderId
  ) {
    const shop = await Shop.findById(shopId);

    if (!shop) {
      throw new Error(`Shop not found: ${shopId}`);
    }

    const accessToken =
      await this.getConvertyAccessToken(shop);

    const response = await axios.get(
      'https://api.converty.shop/api/v1/orders/' +
        encodeURIComponent(externalOrderId),
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          Accept: 'application/json'
        },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      const error =
        new Error(
          'Unable to fetch Converty order status'
        );

      error.status = response.status;
      throw error;
    }

    const source =
      response.data?.data?.order ||
      response.data?.data ||
      response.data ||
      {};

    const rawStatus =
      String(
        source.status ||
        source.orderStatus ||
        ''
      ).trim();

    if (!rawStatus) {
      return {
        matched: false,
        updated: false
      };
    }

    const result = await Order.updateOne(
      {
        shopId,
        $or: [
          {
            orderId:
              String(externalOrderId)
          },
          {
            externalOrderId:
              String(externalOrderId)
          }
        ]
      },
      {
        $set: {
          externalStatus: {
            platform: 'converty',
            code:
              rawStatus.toLowerCase(),
            label: rawStatus,
            syncedAt: new Date()
          }
        }
      }
    );

    return {
      matched: result.matchedCount > 0,
      updated: result.modifiedCount > 0
    };
  }

  async syncConvertyOrders(shopId) {
    const shop = await Shop.findById(shopId);

    if (!shop) {
      throw new Error(`Shop not found: ${shopId}`);
    }

    const boundStoreId =
      shop.convertyCredentials?.storeId
        ? String(
            shop.convertyCredentials.storeId
          )
        : '';

    if (!boundStoreId) {
      const error =
        new Error(
          'Converty store is not bound to this Confirmed shop'
        );

      error.code =
        'CONVERTY_STORE_NOT_BOUND';

      throw error;
    }

    const accessToken =
      await this.getConvertyAccessToken(
        shop
      );

    let page = 1;
    const limit = 50;

    let fetched = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const toNumber = (value, fallback = 0) => {
      const parsed = Number(value);

      return Number.isFinite(parsed)
        ? parsed
        : fallback;
    };

    while (page <= 100) {
      let response;

      const redis =
        getRedisClient();

      if (
        redis &&
        redis.isOpen &&
        redis.isReady
      ) {
        try {
          const cooldownTtl =
            await redis.ttl(
              CONVERTY_RATE_LIMIT_KEY
            );

          if (cooldownTtl > 0) {
            const cooldownError =
              new Error(
                'Converty rate limit cooldown active'
              );

            cooldownError.code =
              'CONVERTY_RATE_LIMIT';

            cooldownError.status =
              429;

            cooldownError.retryAfterSeconds =
              cooldownTtl;

            throw cooldownError;
          }
        } catch (error) {
          if (
            error.code ===
            'CONVERTY_RATE_LIMIT'
          ) {
            throw error;
          }

          logger.warn(
            `Unable to read Converty cooldown: ${error.message}`
          );
        }
      }

      try {
        response = await axios.get(
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
      } catch (error) {
        if (error.response?.status === 429) {
          const rawRetryAfter =
            error.response?.headers?.['retry-after'];

          let retryAfter =
            Number.parseInt(
              rawRetryAfter,
              10
            );

          if (
            !Number.isFinite(retryAfter) &&
            rawRetryAfter
          ) {
            const retryDate =
              Date.parse(rawRetryAfter);

            if (Number.isFinite(retryDate)) {
              retryAfter =
                Math.ceil(
                  (retryDate - Date.now()) /
                  1000
                );
            }
          }

          const cooldownSeconds =
            Number.isFinite(retryAfter) &&
            retryAfter > 0
              ? retryAfter
              : CONVERTY_RATE_LIMIT_FALLBACK_SECONDS;

          const redis =
            getRedisClient();

          if (
            redis &&
            redis.isOpen &&
            redis.isReady
          ) {
            try {
              await redis.set(
                CONVERTY_RATE_LIMIT_KEY,
                '1',
                {
                  EX:
                    cooldownSeconds
                }
              );
            } catch (redisError) {
              logger.warn(
                `Unable to store Converty cooldown: ${redisError.message}`
              );
            }
          }

          const rateLimitError =
            new Error(
              'Converty rate limit reached'
            );

          rateLimitError.code =
            'CONVERTY_RATE_LIMIT';

          rateLimitError.status =
            429;

          rateLimitError.retryAfterSeconds =
            cooldownSeconds;

          throw rateLimitError;
        }

        throw error;
      }

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

      const scopedOrders =
        orders.filter(source =>
          String(source?.store || '') ===
          boundStoreId
        );

      const ignoredForeignOrders =
        orders.length -
        scopedOrders.length;

      if (ignoredForeignOrders > 0) {
        logger.warn(
          'Ignored Converty orders from another store',
          {
            shopId:
              String(shopId),
            boundStoreId,
            ignored:
              ignoredForeignOrders
          }
        );
      }

      fetched += scopedOrders.length;

      for (const source of scopedOrders) {
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

        const existingOrder =
          await Order.findOne({
            shopId,
            orderId
          })
            .select(
              '_id clientInfo items deliveryFee totalAmount'
            )
            .lean();

        const cart =
          Array.isArray(source.cart)
            ? source.cart
            : [];

        const items =
          await Promise.all(
            cart.map(async entry => {
              const product =
                entry?.product || {};

              const externalProductId =
                product?._id
                  ? String(product._id)
                  : null;

              const sku =
                product?.sku ||
                undefined;

              let catalogProduct = null;

              if (externalProductId) {
                catalogProduct =
                  await Product.findOne({
                    shopId,
                    externalId:
                      externalProductId
                  });
              }

              if (
                !catalogProduct &&
                sku
              ) {
                catalogProduct =
                  await Product.findOne({
                    shopId,
                    sku
                  });
              }

              if (
                !catalogProduct &&
                product?.name
              ) {
                catalogProduct =
                  new Product({
                    shopId,

                    externalId:
                      externalProductId ||
                      undefined,

                    name:
                      product.name,

                    price:
                      toNumber(
                        product.price,
                        toNumber(
                          entry?.pricePerUnit,
                          0
                        )
                      ),

                    deliveryFee:
                      toNumber(
                        product.deliveryPrice,
                        0
                      ),

                    sku,

                    syncMethod:
                      'auto_sync',

                    lastSyncAt:
                      new Date()
                  });

                await catalogProduct.save();
              } else if (
                catalogProduct &&
                catalogProduct.syncMethod ===
                  'auto_sync'
              ) {
                if (
                  externalProductId &&
                  !catalogProduct.externalId
                ) {
                  catalogProduct.externalId =
                    externalProductId;
                }

                if (product?.name) {
                  catalogProduct.name =
                    product.name;
                }

                if (sku) {
                  catalogProduct.sku =
                    sku;
                }

                catalogProduct.price =
                  toNumber(
                    product.price,
                    toNumber(
                      entry?.pricePerUnit,
                      catalogProduct.price
                    )
                  );

                catalogProduct.lastSyncAt =
                  new Date();

                await catalogProduct.save();
              }

              return {
                productId:
                  catalogProduct?._id,

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

                sku,

                url:
                  catalogProduct?.productLink ||
                  undefined
              };
            })
          );

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

        if (existingOrder) {
          /*
           * Update only data owned by Converty.
           *
           * Mongo subdocuments in items have internal _id values.
           * Those IDs must never be used to decide whether the
           * Converty order actually changed.
           */
          const syncedFields = {
            items,
            deliveryFee:
              toNumber(
                source?.total?.deliveryPrice,
                0
              ),
            totalAmount
          };

          if (
            source?.customer?.name !==
              undefined &&
            source?.customer?.name !==
              null
          ) {
            syncedFields[
              'clientInfo.name'
            ] =
              source.customer.name;
          }

          if (
            source?.customer?.phone !==
              undefined &&
            source?.customer?.phone !==
              null
          ) {
            syncedFields[
              'clientInfo.phone'
            ] =
              source.customer.phone;
          }

          if (
            source?.customer?.email !==
              undefined &&
            source?.customer?.email !==
              null
          ) {
            syncedFields[
              'clientInfo.email'
            ] =
              source.customer.email;
          }

          if (
            source?.customer?.address !==
              undefined &&
            source?.customer?.address !==
              null
          ) {
            syncedFields[
              'clientInfo.address.street'
            ] =
              source.customer.address;
          }

          if (
            source?.customer?.city !==
              undefined &&
            source?.customer?.city !==
              null
          ) {
            syncedFields[
              'clientInfo.address.city'
            ] =
              source.customer.city;

            syncedFields[
              'clientInfo.address.state'
            ] =
              source.customer.city;

            syncedFields.region =
              source.customer.city;
          }

          const normalizeItems =
            value =>
              (Array.isArray(value)
                ? value
                : []
              ).map(item => ({
                productId:
                  item?.productId
                    ? String(item.productId)
                    : null,
                name:
                  item?.name || '',
                quantity:
                  toNumber(
                    item?.quantity,
                    1
                  ),
                price:
                  toNumber(
                    item?.price,
                    0
                  ),
                sku:
                  item?.sku || null,
                url:
                  item?.url || null
              }));

          const currentComparable = {
            items:
              normalizeItems(
                existingOrder.items
              ),

            deliveryFee:
              toNumber(
                existingOrder.deliveryFee,
                0
              ),

            totalAmount:
              toNumber(
                existingOrder.totalAmount,
                0
              ),

            name:
              existingOrder.clientInfo
                ?.name || '',

            phone:
              existingOrder.clientInfo
                ?.phone || '',

            email:
              existingOrder.clientInfo
                ?.email || null,

            street:
              existingOrder.clientInfo
                ?.address?.street || '',

            city:
              existingOrder.clientInfo
                ?.address?.city || '',

            state:
              existingOrder.clientInfo
                ?.address?.state || '',

            region:
              existingOrder.region || ''
          };

          const nextComparable = {
            items:
              normalizeItems(items),

            deliveryFee:
              syncedFields.deliveryFee,

            totalAmount:
              syncedFields.totalAmount,

            name:
              syncedFields[
                'clientInfo.name'
              ] ??
              currentComparable.name,

            phone:
              syncedFields[
                'clientInfo.phone'
              ] ??
              currentComparable.phone,

            email:
              syncedFields[
                'clientInfo.email'
              ] ??
              currentComparable.email,

            street:
              syncedFields[
                'clientInfo.address.street'
              ] ??
              currentComparable.street,

            city:
              syncedFields[
                'clientInfo.address.city'
              ] ??
              currentComparable.city,

            state:
              syncedFields[
                'clientInfo.address.state'
              ] ??
              currentComparable.state,

            region:
              syncedFields.region ??
              currentComparable.region
          };

          const hasChanges =
            JSON.stringify(
              currentComparable
            ) !==
            JSON.stringify(
              nextComparable
            );

          if (!hasChanges) {
            skipped += 1;
            continue;
          }

          await Order.updateOne(
            {
              _id:
                existingOrder._id
            },
            {
              $set:
                syncedFields
            }
          );

          updated += 1;
          continue;
        }

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
                '',

              email:
                source?.customer?.email ||
                undefined,

              address:
                (
                  source?.customer?.address ||
                  source?.customer?.city
                )
                  ? {
                      street:
                        source?.customer?.address ||
                        '',

                      city:
                        source?.customer?.city ||
                        '',

                      state:
                        source?.customer?.city ||
                        ''
                    }
                  : undefined
            },

            region:
              source?.customer?.city ||
              '',

            items,

            deliveryFee:
              toNumber(
                source?.total?.deliveryPrice,
                0
              ),

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
      `${updated} updated, ` +
      `${skipped} skipped`
    );

    return {
      fetched,
      created,
      updated,
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