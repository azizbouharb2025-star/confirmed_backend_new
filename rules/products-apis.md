# Products APIs

Base URL: `http://localhost:3000/api/products`

## Overview
Product management APIs handle product catalog operations, platform synchronization, and inventory management for e-commerce integrations.

## Authentication
All endpoints require JWT authentication.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Shop Products
**GET** `/`

Retrieves paginated list of products for the authenticated user's shop.

**Required Role:** Any authenticated user

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Example:** `/api/products?page=1&limit=20`

**Response (200):**
```json
{
  "products": [
    {
      "_id": "product_id",
      "name": "Premium Headphones",
      "description": "High-quality wireless headphones",
      "price": 199.99,
      "sku": "HEADPHONES-001",
      "category": "Electronics",
      "images": [
        "https://example.com/image1.jpg",
        "https://example.com/image2.jpg"
      ],
      "url": "https://shop.com/premium-headphones",
      "shopId": "shop_id",
      "externalId": "shopify_product_123",
      "platform": "shopify",
      "inventory": {
        "quantity": 50,
        "inStock": true,
        "lowStockThreshold": 10
      },
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalProducts": 95,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

### 2. Add Manual Product
**POST** `/`

Creates a new product manually in the system.

**Required Role:** Any authenticated user

**Request Body:**
```json
{
  "name": "Custom Product",
  "description": "Manually added product",
  "price": 49.99,
  "sku": "CUSTOM-001",
  "category": "Custom",
  "images": [
    "https://example.com/custom-image.jpg"
  ],
  "url": "https://shop.com/custom-product",
  "inventory": {
    "quantity": 25,
    "lowStockThreshold": 5
  }
}
```

**Response (201):**
```json
{
  "_id": "new_product_id",
  "name": "Custom Product",
  "description": "Manually added product",
  "price": 49.99,
  "sku": "CUSTOM-001",
  "category": "Custom",
  "images": [
    "https://example.com/custom-image.jpg"
  ],
  "url": "https://shop.com/custom-product",
  "shopId": "shop_id",
  "platform": "manual",
  "inventory": {
    "quantity": 25,
    "inStock": true,
    "lowStockThreshold": 5
  },
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Responses:**
- `400`: Invalid product data
- `401`: Unauthorized
- `500`: Server error

---

### 3. Sync Products from Platform
**POST** `/sync`

Synchronizes products from connected e-commerce platform (Shopify/WooCommerce).

**Required Role:** Any authenticated user

**Request Body:**
```json
{
  "platform": "shopify" // or "woocommerce"
}
```

**Response (200):**
```json
{
  "message": "Products synced successfully",
  "syncResults": {
    "totalProcessed": 150,
    "newProducts": 25,
    "updatedProducts": 120,
    "errors": 5,
    "syncTime": "2024-01-01T10:30:00.000Z"
  }
}
```

**Features:**
- **Automatic Sync**: Pulls products from platform API
- **Duplicate Detection**: Prevents duplicate product creation
- **Inventory Updates**: Syncs stock levels and availability
- **Image Processing**: Downloads and processes product images
- **Category Mapping**: Maps platform categories to system categories

**Error Responses:**
- `400`: Unsupported platform or invalid request
- `401`: Unauthorized
- `500`: Server error or sync failure

---

### 4. Update Product
**PUT** `/:id`

Updates an existing product in the shop's catalog.

**Required Role:** Any authenticated user

**URL Parameters:**
- `id`: Product ID

**Request Body:**
```json
{
  "name": "Updated Product Name",
  "description": "Updated description",
  "price": 59.99,
  "category": "Updated Category",
  "inventory": {
    "quantity": 30,
    "lowStockThreshold": 8
  },
  "isActive": false
}
```

**Response (200):**
```json
{
  "_id": "product_id",
  "name": "Updated Product Name",
  "description": "Updated description",
  "price": 59.99,
  "sku": "PROD-001",
  "category": "Updated Category",
  "shopId": "shop_id",
  "inventory": {
    "quantity": 30,
    "inStock": true,
    "lowStockThreshold": 8
  },
  "isActive": false,
  "updatedAt": "2024-01-01T10:30:00.000Z"
}
```

**Error Responses:**
- `400`: Invalid update data
- `401`: Unauthorized
- `404`: Product not found
- `500`: Server error

---

### 5. Delete Product
**DELETE** `/:id`

Removes a product from the shop's catalog.

**Required Role:** Any authenticated user

**URL Parameters:**
- `id`: Product ID

**Response (200):**
```json
{
  "message": "Product deleted successfully",
  "deletedProduct": {
    "_id": "product_id",
    "name": "Deleted Product",
    "sku": "PROD-001"
  }
}
```

**Error Responses:**
- `401`: Unauthorized
- `404`: Product not found
- `500`: Server error

## Platform Integration

### Shopify Integration
**API Endpoints Used:**
- `GET /admin/api/2023-10/products.json` - Fetch products
- `GET /admin/api/2023-10/products/{id}/images.json` - Fetch images

**Sync Process:**
1. Authenticate with Shopify API using access token
2. Fetch products in batches (250 per request)
3. Process product data and images
4. Create/update products in local database
5. Handle variants and inventory levels

### WooCommerce Integration
**API Endpoints Used:**
- `GET /wp-json/wc/v3/products` - Fetch products
- `GET /wp-json/wc/v3/products/categories` - Fetch categories

**Sync Process:**
1. Authenticate with WooCommerce REST API
2. Fetch products with pagination
3. Process product attributes and variations
4. Sync inventory and pricing data
5. Handle product categories and tags

## Product Data Structure

### Core Fields
- **name**: Product display name
- **description**: Product description
- **price**: Product price (decimal)
- **sku**: Stock Keeping Unit (unique identifier)
- **category**: Product category
- **images**: Array of image URLs
- **url**: Product page URL

### Platform Fields
- **externalId**: Platform-specific product ID
- **platform**: Source platform (shopify, woocommerce, manual)
- **platformData**: Platform-specific metadata

### Inventory Management
- **quantity**: Available stock quantity
- **inStock**: Boolean stock status
- **lowStockThreshold**: Minimum stock alert level
- **trackInventory**: Whether to track inventory

## Sync Features

### Automatic Synchronization
- **Scheduled Sync**: Regular background synchronization
- **Webhook Sync**: Real-time updates via webhooks
- **Manual Sync**: On-demand synchronization
- **Incremental Sync**: Only sync changed products

### Data Validation
- **Required Fields**: Validate essential product data
- **Price Validation**: Ensure valid pricing format
- **SKU Uniqueness**: Prevent duplicate SKUs
- **Image Validation**: Verify image URLs and formats

### Error Handling
- **Sync Failures**: Log and retry failed syncs
- **API Limits**: Handle platform API rate limits
- **Data Conflicts**: Resolve conflicting product data
- **Network Issues**: Retry on network failures

## Search and Filtering

### Product Search
- **Name Search**: Search by product name
- **SKU Search**: Find products by SKU
- **Category Filter**: Filter by product category
- **Price Range**: Filter by price range

### Sorting Options
- **Name**: Alphabetical sorting
- **Price**: Price-based sorting
- **Created Date**: Newest/oldest first
- **Stock Level**: Inventory-based sorting

## Integration with Orders

### Order Item Enrichment
- **Product URLs**: Add product page links to orders
- **Product Images**: Include product images in order details
- **Inventory Check**: Verify stock availability
- **Price Validation**: Ensure current pricing