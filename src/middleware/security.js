const rateLimit = require('express-rate-limit');
const xss = require('xss');
const { getRedisClient } = require('../config/redis');

// Plan-based rate limiting
const planLimiter = async (req, res, next) => {
  try {
    if (req.user && req.user.shopId) {
      const shop = await require('../models/Shop').findById(req.user.shopId).populate('subscriptionId');
      const plan = shop.subscriptionId?.plan;
      
      const limits = {
        free: { windowMs: 15 * 60 * 1000, max: 50 },
        premium: { windowMs: 15 * 60 * 1000, max: 200 },
        enterprise: { windowMs: 15 * 60 * 1000, max: 1000 }
      };
      
      const limit = limits[plan] || limits.free;
      const limiter = rateLimit({
        windowMs: limit.windowMs,
        max: limit.max,
        keyGenerator: (req) => `${req.user.shopId}:${req.ip}`,
        message: { error: `Rate limit exceeded for ${plan} plan` }
      });
      
      return limiter(req, res, next);
    }
    next();
  } catch (error) {
    next(error);
  }
};

// XSS sanitization options
const xssOptions = {
  whiteList: {},          // No tags allowed
  stripIgnoreTag: true,   // Strip all non-whitelisted tags
  stripIgnoreTagBody: ['script', 'style'] // Remove script/style content entirely
};

// Input sanitization using xss library
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return xss(obj, xssOptions);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => sanitize(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };
  
  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  next();
};

// HTTPS redirect
const httpsRedirect = (req, res, next) => {
  // Skip redirect for preflight OPTIONS requests — redirecting them breaks CORS
  if (req.method === 'OPTIONS') {
    return next();
  }
  // Only redirect in production and when behind a proxy
  if (process.env.NODE_ENV === 'production' && req.get('x-forwarded-proto') === 'http') {
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  next();
};

module.exports = { planLimiter, sanitizeInput, httpsRedirect };