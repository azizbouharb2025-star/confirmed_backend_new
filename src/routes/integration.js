const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { auth, authorize } = require('../middleware/auth');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const shopIntegrationService = require('../services/shopIntegrationService');

const router = express.Router();

const CONVERTY_AUTHORIZE_URL =
  'https://partner.converty.shop/oauth2/authorize';

const CONVERTY_TOKEN_URL =
  'https://partner.converty.shop/oauth2/token';

const CONVERTY_SCOPES = [
  'read-hooks',
  'create-hooks',
  'delete-hooks',
  'read-orders',
  'read-stores'
];

function getConvertyConfig() {
  const clientId = process.env.CONVERTY_CLIENT_ID;
  const clientSecret = process.env.CONVERTY_CLIENT_SECRET;
  const redirectUri = process.env.CONVERTY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Converty OAuth environment variables are missing'
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri
  };
}

function createConvertyState(shopId) {
  const { clientSecret } = getConvertyConfig();

  const payload = Buffer
    .from(
      JSON.stringify({
        shopId: String(shopId),
        expiresAt: Date.now() + (10 * 60 * 1000)
      })
    )
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function verifyConvertyState(state) {
  const { clientSecret } = getConvertyConfig();

  if (!state || !state.includes('.')) {
    throw new Error('Invalid OAuth state');
  }

  const [payload, signature] = state.split('.');

  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(
      expectedBuffer,
      signatureBuffer
    )
  ) {
    throw new Error('Invalid OAuth state signature');
  }

  const decoded = JSON.parse(
    Buffer
      .from(payload, 'base64url')
      .toString('utf8')
  );

  if (
    !decoded.shopId ||
    !decoded.expiresAt ||
    decoded.expiresAt < Date.now()
  ) {
    throw new Error('Expired OAuth state');
  }

  return decoded;
}

// ------------------------------------------------------------
// Converty webhook receiver
//
// Converty does not currently document a webhook signature.
// The URL therefore contains a high-entropy per-shop key.
//
// IMPORTANT:
// The inbound payload is NOT trusted as order data.
// It is only used as a trigger. Confirmed fetches the real
// orders again through the authenticated Converty API.
// ------------------------------------------------------------

router.post(
  '/converty/webhook/:shopId/:secret',
  async (req, res) => {
    try {
      const {
        shopId,
        secret
      } = req.params;

      if (
        !/^[a-f0-9]{24}$/i.test(shopId) ||
        !secret
      ) {
        return res.status(404).json({
          success: false
        });
      }

      const shop =
        await Shop.findOne({
          _id: shopId,
          platform: 'converty',
          isActive: true
        })
          .select(
            '_id convertyCredentials.webhookSecret'
          );

      if (!shop) {
        return res.status(404).json({
          success: false
        });
      }

      const expectedSecret =
        shop.convertyCredentials?.webhookSecret ||
        '';

      const providedBuffer =
        Buffer.from(String(secret));

      const expectedBuffer =
        Buffer.from(String(expectedSecret));

      const secretValid =
        expectedBuffer.length > 0 &&
        providedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(
          providedBuffer,
          expectedBuffer
        );

      if (!secretValid) {
        return res.status(401).json({
          success: false
        });
      }

      /*
       * Avoid several Converty events launching the same
       * API synchronization simultaneously.
       */
      const redis =
        getRedisClient();

      if (
        redis &&
        redis.isOpen &&
        redis.isReady
      ) {
        const acquired =
          await redis.set(
            `confirmed:converty:webhook:${shopId}`,
            '1',
            {
              NX: true,
              EX: 15
            }
          );

        if (!acquired) {
          return res.status(200).json({
            success: true
          });
        }
      }

      /*
       * Acknowledge Converty immediately.
       *
       * The real synchronization runs afterwards.
       * Polling remains the fallback if this async task fails.
       */
      res.status(200).json({
        success: true
      });

      setImmediate(
        async () => {
          try {
            const result =
              await shopIntegrationService
                .syncConvertyOrders(shopId);

            logger.info(
              'Converty webhook sync completed',
              {
                shopId,
                fetched:
                  result?.fetched || 0,
                created:
                  result?.created || 0,
                skipped:
                  result?.skipped || 0
              }
            );
          } catch (error) {
            logger.error(
              'Converty webhook sync failed',
              {
                shopId,
                message:
                  error.message,
                status:
                  error.status ||
                  error.response?.status ||
                  null
              }
            );
          }
        }
      );

      return undefined;
    } catch (error) {
      logger.error(
        'Converty webhook receiver failed',
        {
          message:
            error.message
        }
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false
        });
      }

      return undefined;
    }
  }
);

// ------------------------------------------------------------
// Generate the Converty authorization URL
// ------------------------------------------------------------

router.get(
  '/converty/oauth/start',
  auth,
  authorize('shop_owner', 'admin'),
  async (req, res, next) => {
    try {
      const shopId =
        req.user.role === 'admin' && req.query.shopId
          ? req.query.shopId
          : req.user.shopId;

      if (!shopId) {
        return res.status(400).json({
          error: 'Shop is required'
        });
      }

      const shop = await Shop
        .findById(shopId)
        .select('_id name platform');

      if (!shop) {
        return res.status(404).json({
          error: 'Shop not found'
        });
      }

      const {
        clientId,
        redirectUri
      } = getConvertyConfig();

      const state =
        createConvertyState(shop._id);

      const params =
        new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: CONVERTY_SCOPES.join(' '),
          state
        });

      return res.json({
        authorizationUrl:
          `${CONVERTY_AUTHORIZE_URL}?${params.toString()}`
      });
    } catch (error) {
      next(error);
    }
  }
);

// ------------------------------------------------------------
// OAuth callback
// ------------------------------------------------------------

router.get(
  '/converty/oauth/callback',
  async (req, res) => {
    try {
      if (req.query.error) {
        return res.status(400).json({
          error: 'Converty authorization rejected',
          detail: String(req.query.error)
        });
      }

      const code =
        typeof req.query.code === 'string'
          ? req.query.code
          : '';

      const state =
        typeof req.query.state === 'string'
          ? req.query.state
          : '';

      if (!code || !state) {
        return res.status(400).json({
          error: 'Missing OAuth code or state'
        });
      }

      const stateData =
        verifyConvertyState(state);

      const {
        clientId,
        clientSecret,
        redirectUri
      } = getConvertyConfig();

      const form =
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri
        });

      const tokenResponse =
        await axios.post(
          CONVERTY_TOKEN_URL,
          form.toString(),
          {
            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded'
            },
            timeout: 15000,
            validateStatus: () => true
          }
        );

      if (
        tokenResponse.status < 200 ||
        tokenResponse.status >= 300
      ) {
        const detail =
          tokenResponse.data?.message ||
          tokenResponse.data?.error ||
          'Token exchange failed';

        return res.status(502).json({
          error: 'Converty token exchange failed',
          status: tokenResponse.status,
          detail
        });
      }

      const tokenData =
        tokenResponse.data?.data ||
        tokenResponse.data ||
        {};

      const accessToken =
        tokenData.access_token ||
        tokenData.accessToken ||
        tokenData.token;

      const refreshToken =
        tokenData.refresh_token ||
        tokenData.refreshToken ||
        null;

      if (!accessToken) {
        return res.status(502).json({
          error:
            'Converty response did not contain an access token',
          receivedFields:
            Object.keys(tokenData)
        });
      }

      const expiresIn =
        Number(
          tokenData.expires_in ||
          tokenData.expiresIn ||
          0
        );

      const rawStore =
        tokenData.store ||
        tokenData.store_id ||
        tokenData.storeId ||
        null;

      const storeId =
        rawStore &&
        typeof rawStore === 'object'
          ? (
              rawStore._id ||
              rawStore.id ||
              null
            )
          : rawStore;

      const rawScopes =
        tokenData.grantedScopes ||
        tokenData.granted_scopes ||
        tokenData.scope ||
        [];

      const grantedScopes =
        Array.isArray(rawScopes)
          ? rawScopes
          : typeof rawScopes === 'string'
            ? rawScopes.split(/[ ,]+/).filter(Boolean)
            : [];

      const update = {
        platform: 'converty',
        'convertyCredentials.accessToken':
          accessToken,
        'convertyCredentials.connectedAt':
          new Date()
      };

      if (refreshToken) {
        update[
          'convertyCredentials.refreshToken'
        ] = refreshToken;
      }

      if (tokenData.token_type || tokenData.tokenType) {
        update[
          'convertyCredentials.tokenType'
        ] =
          tokenData.token_type ||
          tokenData.tokenType;
      }

      if (storeId) {
        update[
          'convertyCredentials.storeId'
        ] = String(storeId);
      }

      if (grantedScopes.length) {
        update[
          'convertyCredentials.grantedScopes'
        ] = grantedScopes;
      }

      if (expiresIn > 0) {
        update[
          'convertyCredentials.expiresAt'
        ] =
          new Date(
            Date.now() +
            (expiresIn * 1000)
          );
      }

      const shop =
        await Shop.findByIdAndUpdate(
          stateData.shopId,
          {
            $set: update
          },
          {
            new: true
          }
        );

      if (!shop) {
        return res.status(404).json({
          error: 'Confirmed shop not found'
        });
      }

      const frontendUrl =
        (process.env.FRONTEND_URL || 'https://confirmed.tn')
          .replace(/\/$/, '');

      return res.redirect(
        302,
        `${frontendUrl}/panel/client/shops?converty=connected`
      );
    } catch (error) {
      return res.status(400).json({
        error: 'Converty OAuth failed',
        detail: error.message
      });
    }
  }
);

// ------------------------------------------------------------
// Connection status - never expose tokens
// ------------------------------------------------------------

router.get(
  '/converty/status',
  auth,
  authorize('shop_owner', 'admin'),
  async (req, res, next) => {
    try {
      const shopId =
        req.user.role === 'admin' && req.query.shopId
          ? req.query.shopId
          : req.user.shopId;

      const shop = await Shop
        .findById(shopId)
        .select(
          'platform convertyCredentials.storeId ' +
          'convertyCredentials.grantedScopes ' +
          'convertyCredentials.expiresAt ' +
          'convertyCredentials.connectedAt ' +
          'convertyCredentials.accessToken'
        );

      if (!shop) {
        return res.status(404).json({
          error: 'Shop not found'
        });
      }

      return res.json({
        connected:
          Boolean(
            shop.convertyCredentials?.accessToken
          ),
        platform: shop.platform,
        storeId:
          shop.convertyCredentials?.storeId || null,
        grantedScopes:
          shop.convertyCredentials?.grantedScopes || [],
        expiresAt:
          shop.convertyCredentials?.expiresAt || null,
        connectedAt:
          shop.convertyCredentials?.connectedAt || null
      });
    } catch (error) {
      next(error);
    }
  }
);

// Middleware to authenticate API credentials
const authenticateApiKey = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    let apiKey, apiSecret;
    
    // Support both Bearer token and Basic auth
    if (authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    } else if (authHeader.startsWith('Basic ')) {
      const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
      [apiKey, apiSecret] = credentials.split(':');
    } else {
      return res.status(401).json({ error: 'Invalid authorization format' });
    }

    const shop = await Shop.findOne({
      _id: shopId,
      'apiCredentials.apiKey': apiKey,
      'apiCredentials.isActive': true
    });

    if (!shop) {
      return res.status(401).json({ error: 'Invalid API credentials' });
    }

    // Update last used timestamp
    await Shop.findByIdAndUpdate(shopId, {
      'apiCredentials.lastUsed': new Date()
    });

    req.shop = shop;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Get shop info
router.get('/shop/:shopId', authenticateApiKey, (req, res) => {
  const { shop } = req;
  res.json({
    id: shop._id,
    name: shop.name,
    domain: shop.domain,
    platform: shop.platform,
    isActive: shop.isActive
  });
});

// Get shop products
router.get('/shop/:shopId/products', authenticateApiKey, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const products = await Product.find({ 
      shopId, 
      isActive: true 
    })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .sort({ createdAt: -1 });
    
    const total = await Product.countDocuments({ shopId, isActive: true });
    
    res.json({
      products: products.map(p => ({
        id: p._id,
        name: p.name,
        description: p.description,
        price: p.price,
        imageUrl: p.imageUrl,
        productLink: p.productLink,
        category: p.category,
        sku: p.sku,
        syncMethod: p.syncMethod
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get shop orders
router.get('/shop/:shopId/orders', authenticateApiKey, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { page = 1, limit = 50, status } = req.query;
    
    const query = { shopId };
    if (status) query.status = status;
    
    const orders = await Order.find(query)
      .populate('productId', 'name price imageUrl')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await Order.countDocuments(query);
    
    res.json({
      orders: orders.map(o => ({
        id: o._id,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        product: o.productId,
        quantity: o.quantity,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: o.createdAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create order via API
router.post('/shop/:shopId/orders', authenticateApiKey, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { customerName, customerPhone, productId, quantity, totalAmount } = req.body;
    
    if (!customerName || !customerPhone || !productId || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const order = new Order({
      shopId,
      customerName,
      customerPhone,
      productId,
      quantity,
      totalAmount: totalAmount || 0,
      status: 'pending'
    });
    
    await order.save();
    await order.populate('productId', 'name price imageUrl');
    
    res.status(201).json({
      message: 'Order created successfully',
      order: {
        id: order._id,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        product: order.productId,
        quantity: order.quantity,
        totalAmount: order.totalAmount,
        status: order.status
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
