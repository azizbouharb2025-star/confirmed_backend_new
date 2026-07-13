# Shop & Delivery Integration API

## Overview
This document describes the enhanced API endpoints for shop integrations, product management, and delivery platform integrations.

## Shop Integration

### Supported Platforms
- **Shopify**: Full integration with products and orders sync
- **WooCommerce**: Complete integration with REST API
- **Custom**: Manual product and order management

### Shop Configuration

#### Update Shop Credentials
```http
PUT /api/shops/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "apiCredentials": {
    "accessToken": "shopify_access_token",     // Shopify
    "consumerKey": "wc_consumer_key",          // WooCommerce
    "consumerSecret": "wc_consumer_secret",    // WooCommerce
    "storeUrl": "https://store.com"            // WooCommerce
  },
  "settings": {
    "productSyncEnabled": true,
    "deliveryIntegrationEnabled": true
  }
}
```

## Product Management

### Get Products
```http
GET /api/products?page=1&limit=20
Authorization: Bearer <token>
```

### Add Manual Product
```http
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Product Name",
  "url": "https://shop.com/products/product-name",
  "price": 29.99,
  "sku": "PROD-001",
  "description": "Product description",
  "imageUrl": "https://shop.com/images/product.jpg",
  "category": "Electronics",
  "inStock": true
}
```

### Sync Products from Platform
```http
POST /api/products/sync
Authorization: Bearer <token>
Content-Type: application/json

{
  "platform": "shopify" // or "woocommerce"
}
```

### Update Product
```http
PUT /api/products/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Product Name",
  "price": 39.99,
  "inStock": false
}
```

## Delivery Integration

### Setup Delivery Integration
```http
POST /api/delivery/integration
Authorization: Bearer <token>
Content-Type: application/json

{
  "platform": "aramex",
  "credentials": {
    "username": "aramex_username",
    "password": "aramex_password",
    "accountNumber": "123456",
    "apiKey": "aramex_api_key",
    "baseUrl": "https://ws.aramex.net"
  },
  "settings": {
    "autoCreateShipment": true,
    "trackingEnabled": true,
    "webhookUrl": "https://yourapp.com/webhooks/delivery"
  }
}
```

### Create Shipment
```http
POST /api/delivery/shipment/:orderId
Authorization: Bearer <token>
```

### Track Shipment
```http
GET /api/delivery/track/:orderId
Authorization: Bearer <token>
```

## External API (for Shop Integration)

### API Key Authentication
All external API calls require an API key in the header:
```http
X-API-Key: your_generated_api_key
```

### Create Order with Products
```http
POST /external-api/orders
X-API-Key: your_api_key
Content-Type: application/json

{
  "orderId": "ORDER-123",
  "clientInfo": {
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com"
  },
  "items": [
    {
      "name": "Product Name",
      "quantity": 2,
      "price": 29.99,
      "sku": "PROD-001"
    }
  ],
  "totalAmount": 59.98
}
```

### Sync Products via External API
```http
POST /external-api/products/sync
X-API-Key: your_api_key
Content-Type: application/json

{
  "platform": "shopify"
}
```

### Add Product via External API
```http
POST /external-api/products
X-API-Key: your_api_key
Content-Type: application/json

{
  "name": "New Product",
  "url": "https://shop.com/products/new-product",
  "price": 49.99,
  "sku": "NEW-001"
}
```

## Webhook Integration

### Shopify Webhooks
Configure these webhooks in your Shopify admin:

#### Order Creation
```
POST /api/webhooks/shopify/orders/create
```

#### Product Updates
```
POST /api/webhooks/shopify/products/update
```

### WooCommerce Webhooks
Configure these webhooks in WooCommerce settings:

#### Order Creation
```
POST /api/webhooks/woocommerce/orders/create
```

#### Product Updates
```
POST /api/webhooks/woocommerce/products/update
```

## Background Jobs

### Automatic Sync
The system automatically syncs orders and products every 15 minutes for shops with `autoSync: true`.

### Manual Sync
Trigger manual sync for specific shops:
```http
POST /api/shops/:id/sync
Authorization: Bearer <token>
```

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common Error Codes
- `INVALID_API_KEY`: API key is invalid or missing
- `PLATFORM_NOT_SUPPORTED`: Unsupported e-commerce platform
- `SYNC_FAILED`: Product or order sync failed
- `DELIVERY_INTEGRATION_ERROR`: Delivery platform integration error
- `PRODUCT_NOT_FOUND`: Product not found
- `ORDER_NOT_FOUND`: Order not found

## Rate Limits
- External API: 100 requests per 15 minutes per API key
- Internal API: 100 requests per 15 minutes per IP
- Webhook endpoints: 1000 requests per minute

## Security
- All API endpoints use HTTPS
- API keys are encrypted in database
- Rate limiting prevents abuse
- Input validation and sanitization
- CORS protection