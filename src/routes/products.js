const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { auth } = require('../middleware/auth');
const productService = require('../services/productService');
const Product = require('../models/Product');

const createProductSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required(),
  imageUrl: Joi.string().uri().required(),
  productLink: Joi.string().uri().required(),
  price: Joi.number().min(0).default(0),
  category: Joi.string(),
  sku: Joi.string()
});

// Get shop products
router.get('/shop/:shopId', auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { page = 1, limit = 20, syncMethod } = req.query;
    
    // Verify user has access to this shop
    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }
    
    const query = { shopId, isActive: true };
    
    if (syncMethod) {
      query.syncMethod = syncMethod;
    }
    
    const products = await Product.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
      
    const total = await Product.countDocuments(query);
    
    res.json({
      products,
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

// Add manual product to shop
router.post('/shop/:shopId', auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    
    // Verify user has access to this shop
    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }
    
    const { error } = createProductSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const product = new Product({
      ...req.body,
      shopId,
      syncMethod: 'manual'
    });

    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Sync products from platform for specific shop
router.post('/shop/:shopId/sync', auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    
    // Verify user has access to this shop
    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }
    
    const Shop = require('../models/Shop');
    const shop = await Shop.findById(shopId);
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.settings.productSyncEnabled) {
      return res.status(400).json({ error: 'Product sync is disabled for this shop' });
    }
    
    if (shop.platform === 'shopify') {
      await productService.syncShopifyProducts(shopId);
    } else if (shop.platform === 'woocommerce') {
      await productService.syncWooCommerceProducts(shopId);
    } else if (shop.platform === 'meta') {
      await productService.syncMetaProducts(shopId);
    } else {
      return res.status(400).json({ error: 'Auto-sync not supported for this platform' });
    }
    
    res.json({ message: 'Products synced successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle auto-sync for specific shop
router.patch('/shop/:shopId/auto-sync', auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { enabled } = req.body;
    
    // Verify user has access to this shop
    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }
    
    const Shop = require('../models/Shop');
    
    const shop = await Shop.findByIdAndUpdate(
      shopId,
      { 'settings.productSyncEnabled': enabled },
      { new: true }
    );
    
    res.json({ 
      message: `Auto-sync ${enabled ? 'enabled' : 'disabled'}`,
      autoSyncEnabled: shop.settings.productSyncEnabled
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update product in specific shop
router.put('/shop/:shopId/product/:id', auth, async (req, res) => {
  try {
    const { shopId, id } = req.params;
    
    // Verify user has access to this shop
    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }
    
    const product = await Product.findOne({
      _id: id,
      shopId
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.syncMethod === 'auto_sync') {
      return res.status(400).json({ 
        error: 'Cannot update auto-synced products. Disable auto-sync first.' 
      });
    }
    
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );
    
    res.json(updatedProduct);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete product from specific shop
router.delete('/shop/:shopId/product/:id', auth, async (req, res) => {
  try {
    const { shopId, id } = req.params;
    
    // Verify user has access to this shop
    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }
    
    const product = await Product.findOne({
      _id: id,
      shopId
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.syncMethod === 'auto_sync') {
      // Just mark as inactive instead of deleting
      await Product.findByIdAndUpdate(id, { isActive: false });
      res.json({ message: 'Auto-synced product marked as inactive' });
    } else {
      await Product.findByIdAndDelete(id);
      res.json({ message: 'Product deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;