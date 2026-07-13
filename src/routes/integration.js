const express = require('express');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Order = require('../models/Order');

const router = express.Router();

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