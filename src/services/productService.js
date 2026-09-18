const axios = require('axios');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const logger = require('../utils/logger');

/**
 * Convert Converty / CKEditor HTML descriptions to clean plain text.
 * Keeps useful paragraph/list line breaks while removing markup,
 * styles, classes and HTML entities.
 */
const cleanConvertyDescription = value => {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  let text =
    String(value).trim();

  if (!text) {
    return '';
  }

  text = text
    .replace(/\r\n?/g, '\n')

    // Preserve meaningful line breaks before removing HTML.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|section|article|blockquote|pre|h[1-6]|tr)>/gi,
      '\n'
    )
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')

    // Remove all remaining markup.
    .replace(/<[^>]*>/g, '');

  // Decode numeric HTML entities.
  text = text
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) => {
        try {
          return String.fromCodePoint(
            parseInt(code, 16)
          );
        } catch {
          return '';
        }
      }
    )
    .replace(
      /&#(\d+);/g,
      (_, code) => {
        try {
          return String.fromCodePoint(
            parseInt(code, 10)
          );
        } catch {
          return '';
        }
      }
    );

  // Decode common named entities.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\u00a0/g, ' ');

  // Normalize spaces while preserving paragraphs.
  text = text
    .split('\n')
    .map(line =>
      line
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
};

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

  async syncConvertyProducts(shopId) {
    const shop = await Shop.findById(shopId);

    if (!shop) {
      throw new Error(`Shop not found: ${shopId}`);
    }

    if (shop.platform !== 'converty') {
      throw new Error('Shop is not a Converty shop');
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

    /*
     * Lazy require avoids a module initialization cycle:
     * shopIntegrationService already imports productService.
     */
    const shopIntegrationService =
      require('./shopIntegrationService');

    const accessToken =
      await shopIntegrationService
        .getConvertyAccessToken(shop);

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
      const response = await axios.get(
        'https://api.converty.shop/api/v1/products',
        {
          params: {
            page,
            limit
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

      const root = response.data || {};
      const payload = root.data;

      const products =
        Array.isArray(payload)
          ? payload
          : payload?.products ||
            payload?.items ||
            payload?.docs ||
            [];

      if (!Array.isArray(products)) {
        throw new Error(
          'Unexpected Converty products response'
        );
      }

      const scopedProducts =
        products.filter(source =>
          String(source?.store || '') ===
          boundStoreId
        );

      const ignoredForeignProducts =
        products.length -
        scopedProducts.length;

      if (ignoredForeignProducts > 0) {
        logger.warn(
          'Ignored Converty products from another store',
          {
            shopId:
              String(shopId),
            boundStoreId,
            ignored:
              ignoredForeignProducts
          }
        );
      }

      fetched += scopedProducts.length;

      for (const source of scopedProducts) {
        const externalId =
          source?._id
            ? String(source._id)
            : source?.id
              ? String(source.id)
              : null;

        if (
          !externalId ||
          !source?.name
        ) {
          skipped += 1;
          continue;
        }

        const firstImage =
          Array.isArray(source.images)
            ? source.images[0]
            : null;

        const imageUrl =
          typeof firstImage === 'string'
            ? firstImage
            : firstImage?.lg ||
              firstImage?.md ||
              firstImage?.sm ||
              '';

        const firstCategory =
          Array.isArray(source.categories)
            ? source.categories[0]
            : null;

        const category =
          typeof firstCategory === 'string'
            ? firstCategory
            : firstCategory?.name ||
              firstCategory?.title ||
              firstCategory?.label ||
              '';

        const status =
          String(
            source.status || ''
          ).toLowerCase();

        const isActive =
          source.isDeleted !== true &&
          ![
            'hidden',
            'archived',
            'deleted'
          ].includes(status);

        const inStock =
          source.trackStock === true
            ? toNumber(
                source.stock,
                0
              ) > 0
            : true;

        const mapped = {
          name:
            source.name,

          price:
            toNumber(
              source.price,
              0
            ),

          deliveryFee:
            toNumber(
              source.deliveryPrice,
              0
            ),

          sku:
            source.sku ||
            undefined,

          description:
            cleanConvertyDescription(
              source.description
            ),

          imageUrl,

          category,

          inStock,

          isActive,

          syncMethod:
            'auto_sync',

          lastSyncAt:
            new Date()
        };

        const existing =
          await Product.findOne({
            shopId,
            externalId
          })
            .lean();

        if (!existing) {
          await new Product({
            shopId,
            externalId,
            ...mapped
          }).save();

          created += 1;
          continue;
        }

        const currentComparable = {
          name:
            existing.name || '',

          price:
            toNumber(
              existing.price,
              0
            ),

          deliveryFee:
            toNumber(
              existing.deliveryFee,
              0
            ),

          sku:
            existing.sku || null,

          description:
            existing.description || '',

          imageUrl:
            existing.imageUrl || '',

          category:
            existing.category || '',

          inStock:
            existing.inStock !== false,

          isActive:
            existing.isActive !== false,

          syncMethod:
            existing.syncMethod
        };

        const nextComparable = {
          name:
            mapped.name,

          price:
            mapped.price,

          deliveryFee:
            mapped.deliveryFee,

          sku:
            mapped.sku || null,

          description:
            mapped.description,

          imageUrl:
            mapped.imageUrl,

          category:
            mapped.category,

          inStock:
            mapped.inStock,

          isActive:
            mapped.isActive,

          syncMethod:
            'auto_sync'
        };

        const hasChanges =
          JSON.stringify(
            currentComparable
          ) !==
          JSON.stringify(
            nextComparable
          );

        if (!hasChanges) {
          await Product.updateOne(
            {
              _id:
                existing._id
            },
            {
              $set: {
                lastSyncAt:
                  new Date()
              }
            }
          );

          skipped += 1;
          continue;
        }

        await Product.updateOne(
          {
            _id:
              existing._id
          },
          {
            $set:
              mapped
          }
        );

        updated += 1;
      }

      const total =
        Number(root.count);

      if (
        products.length === 0 ||
        products.length < limit ||
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
      `Converty product sync ${shopId}: ` +
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