const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs/promises');
const router = express.Router();
const { auth } = require('../middleware/auth');
const productService = require('../services/productService');
const Product = require('../models/Product');

const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Format image non autorisé. Formats acceptés : JPG, JPEG, PNG, WEBP.'));
    }

    cb(null, true);
  }
});

const productsUploadDir = path.join(__dirname, '..', '..', 'uploads', 'products');

const createProductSchema = Joi.object({
  name: Joi.string().trim().required(),
  description: Joi.string().allow('').default(''),
  sellerNotes: Joi.string().allow('').default(''),
  imageUrl: Joi.string().uri().allow('').default(''),
  productLink: Joi.string().uri().allow('').default(''),
  price: Joi.number().min(0).required(),
  deliveryFee: Joi.number().min(0).required(),
  category: Joi.string().allow(''),
  sku: Joi.string().allow('')
});

const updateProductSchema = Joi.object({
  name: Joi.string().trim(),
  description: Joi.string().allow(''),
  sellerNotes: Joi.string().allow(''),
  imageUrl: Joi.string().uri().allow(''),
  productLink: Joi.string().uri().allow(''),
  price: Joi.number().min(0),
  deliveryFee: Joi.number().min(0),
  category: Joi.string().allow(''),
  sku: Joi.string().allow('')
}).min(1);

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
    
    const { error, value } = createProductSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const product = new Product({
      ...value,
      shopId,
      syncMethod: 'manual'
    });

    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Upload or replace product image
router.post(
  '/shop/:shopId/product/:id/image',
  auth,
  productImageUpload.single('image'),
  async (req, res) => {
    try {
      const { shopId, id } = req.params;

      if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
        return res.status(403).json({ error: 'Accès refusé à cette boutique' });
      }

      const product = await Product.findOne({
        _id: id,
        shopId
      });

      if (!product) {
        return res.status(404).json({ error: 'Produit introuvable' });
      }

      if (product.syncMethod === 'auto_sync') {
        return res.status(400).json({
          error: 'Impossible de modifier l’image d’un produit synchronisé automatiquement.'
        });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Aucune image reçue' });
      }

      await fs.mkdir(productsUploadDir, { recursive: true });

      const filename = `${id}-${Date.now()}.webp`;
      const outputPath = path.join(productsUploadDir, filename);

      await sharp(req.file.buffer)
        .rotate()
        .resize({
          width: 1200,
          height: 1200,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({
          quality: 82
        })
        .toFile(outputPath);

      const oldImageUrl = product.imageUrl;

      const imageUrl = `${req.protocol}://${req.get('host')}/uploads/products/${filename}`;

      product.imageUrl = imageUrl;
      product.imageUploadedAt = new Date();

      await product.save();

      if (oldImageUrl && oldImageUrl.includes('/uploads/products/')) {
        try {
          const oldFilename = oldImageUrl.split('/uploads/products/').pop();
          if (oldFilename) {
            await fs.unlink(path.join(productsUploadDir, oldFilename));
          }
        } catch {
          // L'ancienne image peut déjà avoir été supprimée.
        }
      }

      res.json({
        imageUrl: product.imageUrl,
        uploadedAt: product.imageUploadedAt,
        message: 'Image du produit enregistrée avec succès.'
      });
    } catch (error) {
      console.error('Product image upload error:', error);
      res.status(500).json({
        error: error.message || "Erreur lors de l'enregistrement de l'image"
      });
    }
  }
);

// Remove product image
router.delete('/shop/:shopId/product/:id/image', auth, async (req, res) => {
  try {
    const { shopId, id } = req.params;

    if (req.user.role !== 'admin' && req.user.shopId.toString() !== shopId) {
      return res.status(403).json({ error: 'Accès refusé à cette boutique' });
    }

    const product = await Product.findOne({
      _id: id,
      shopId
    });

    if (!product) {
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    if (product.syncMethod === 'auto_sync') {
      return res.status(400).json({
        error: 'Impossible de modifier l’image d’un produit synchronisé automatiquement.'
      });
    }

    const oldImageUrl = product.imageUrl;

    product.imageUrl = '';
    product.imageUploadedAt = undefined;

    await product.save();

    if (oldImageUrl && oldImageUrl.includes('/uploads/products/')) {
      try {
        const oldFilename = oldImageUrl.split('/uploads/products/').pop();
        if (oldFilename) {
          await fs.unlink(path.join(productsUploadDir, oldFilename));
        }
      } catch {
        // Le fichier peut déjà avoir été supprimé.
      }
    }

    res.json({
      success: true,
      message: 'Image du produit supprimée avec succès.'
    });
  } catch (error) {
    console.error('Product image delete error:', error);
    res.status(500).json({
      error: error.message || "Erreur lors de la suppression de l'image"
    });
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
    
    const { error, value } = updateProductSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { _id: id, shopId },
      value,
      { new: true, runValidators: true }
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
      const imageUrlToDelete = product.imageUrl;

      await Product.findByIdAndDelete(id);

      if (
        imageUrlToDelete &&
        imageUrlToDelete.includes('/uploads/products/')
      ) {
        try {
          const filename = imageUrlToDelete
            .split('/uploads/products/')
            .pop();

          if (filename) {
            await fs.unlink(
              path.join(productsUploadDir, filename)
            );
          }
        } catch {
          // Le fichier peut déjà avoir été supprimé.
        }
      }

      res.json({
        message: 'Produit supprimé avec succès.'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;