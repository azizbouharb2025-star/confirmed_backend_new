const axios = require('axios');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const logger = require('../utils/logger');

class ProductService {
  async syncShopifyProducts(shopId) {
    try {
      const shop = await Shop.findById(shopId);
      const { accessToken } = shop.apiCredentials;

      const response = await axios.get(`https://${shop.domain}/admin/api/2023-10/products.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken }
      });

      for (const productData of response.data.products) {
        await Product.findOneAndUpdate(
          { shopId, externalId: productData.id.toString() },
          {
            name: productData.title,
            url: `https://${shop.domain}/products/${productData.handle}`,
            price: parseFloat(productData.variants[0]?.price || 0),
            sku: productData.variants[0]?.sku,
            description: productData.body_html,
            imageUrl: productData.images[0]?.src,
            inStock: productData.variants[0]?.inventory_quantity > 0,
            syncedAt: new Date()
          },
          { upsert: true, new: true }
        );
      }

      logger.info(`Synced ${response.data.products.length} products for shop ${shopId}`);
    } catch (error) {
      logger.error(`Failed to sync Shopify products for shop ${shopId}:`, error);
    }
  }

  async syncWooCommerceProducts(shopId) {
    try {
      const shop = await Shop.findById(shopId);
      const { consumerKey, consumerSecret, storeUrl } = shop.apiCredentials;

      const response = await axios.get(`${storeUrl}/wp-json/wc/v3/products`, {
        auth: { username: consumerKey, password: consumerSecret }
      });

      for (const productData of response.data) {
        await Product.findOneAndUpdate(
          { shopId, externalId: productData.id.toString() },
          {
            name: productData.name,
            url: productData.permalink,
            price: parseFloat(productData.price),
            sku: productData.sku,
            description: productData.description,
            imageUrl: productData.images[0]?.src,
            category: productData.categories[0]?.name,
            inStock: productData.stock_status === 'instock',
            syncedAt: new Date()
          },
          { upsert: true, new: true }
        );
      }

      logger.info(`Synced ${response.data.length} products for shop ${shopId}`);
    } catch (error) {
      logger.error(`Failed to sync WooCommerce products for shop ${shopId}:`, error);
    }
  }

  async addManualProduct(shopId, productData) {
    const product = new Product({
      shopId,
      externalId: `manual_${Date.now()}`,
      ...productData
    });
    return await product.save();
  }

  async getShopProducts(shopId, page = 1, limit = 20) {
    return await Product.find({ shopId })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
  }
}

module.exports = new ProductService();