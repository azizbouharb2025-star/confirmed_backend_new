# External APIs

Base URL: `http://localhost:3000/external-api`

## Overview
External APIs provide programmatic access for third-party integrations and external systems. These APIs use API key authentication instead of JWT tokens and are designed for server-to-server communication.

## Authentication
All external API endpoints require API key authentication.

**Headers:**
```
X-API-Key: your_api_key_here
Content-Type: application/json
```

## API Key Management
API keys are generated and managed through the shop management system. Each shop receives a unique API key for external integrations.

## Endpoints

### 1. Create Order (External)
**POST** `/orders`

Creates a new order from external systems with automatic product enrichment.

**Required Authentication:** Valid API key

**Request Body:**
```json
{
  "orderId": "EXT-ORDER-001",
  "clientInfo": {
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com",
    "address": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "USA"
    }
  },
  "items": [
    {
      "name": "Premium Headphones",
      "quantity": 1,
      "price": 199.99,
      "sku": "HEADPHONES-001"
    },
    {
      "name": "Wireless Mouse",
      "quantity": 2,
      "price": 29.99,
      "sku": "MOUSE-002"
    }
  ],
  "totalAmount": 259.97,
  "deliveryInfo": {
    "estimatedDate": "2024-01-15T00:00:00.000Z",
    "carrier": "UPS",
    "service": "ground"
  },
  "metadata": {
    "source": "mobile_app",
    "campaign": "summer_sale",
    "referrer": "google_ads"
  }
}
```

**Response (201):**
```json
{
  "_id": "internal_order_id",
  "orderId": "EXT-ORDER-001",
  "shopId": "shop_id",
  "clientInfo": {
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com",
    "address": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "USA"
    }
  },
  "items": [
    {
      "name": "Premium Headphones",
      "quantity": 1,
      "price": 199.99,
      "sku": "HEADPHONES-001",
      "productId": "product_id_123",
      "url": "https://shop.com/premium-headphones"
    },
    {
      "name": "Wireless Mouse",
      "quantity": 2,
      "price": 29.99,
      "sku": "MOUSE-002",
      "productId": "product_id_456",
      "url": "https://shop.com/wireless-mouse"
    }
  ],
  "totalAmount": 259.97,
  "status": "pending",
  "priority": "normal",
  "deliveryInfo": {
    "estimatedDate": "2024-01-15T00:00:00.000Z",
    "carrier": "UPS",
    "service": "ground"
  },
  "metadata": {
    "source": "mobile_app",
    "campaign": "summer_sale",
    "referrer": "google_ads"
  },
  "createdAt": "2024-01-01T10:30:00.000Z",
  "updatedAt": "2024-01-01T10:30:00.000Z"
}
```

**Features:**
- **Product Enrichment**: Automatically adds product URLs and IDs based on SKU
- **Subscription Limits**: Checks subscription limits before creating order
- **Queue Integration**: Automatically adds order to processing queue
- **Metadata Support**: Stores custom metadata for tracking and analytics

**Error Responses:**
- `401`: Invalid or missing API key
- `400`: Invalid order data or validation errors
- `403`: Subscription limits exceeded
- `500`: Server error

---

### 2. Get Order Status (External)
**GET** `/orders/:orderId`

Retrieves order information and status for external systems.

**Required Authentication:** Valid API key

**URL Parameters:**
- `orderId`: External order ID

**Response (200):**
```json
{
  "_id": "internal_order_id",
  "orderId": "EXT-ORDER-001",
  "shopId": "shop_id",
  "status": "confirmed",
  "clientInfo": {
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com"
  },
  "items": [
    {
      "name": "Premium Headphones",
      "quantity": 1,
      "price": 199.99,
      "sku": "HEADPHONES-001",
      "url": "https://shop.com/premium-headphones"
    }
  ],
  "totalAmount": 259.97,
  "priority": "normal",
  "assignedOperatorId": "operator_id",
  "callHistory": [
    {
      "operatorId": "operator_id",
      "callType": "human",
      "result": "confirmed",
      "notes": "Customer confirmed order details",
      "timestamp": "2024-01-01T11:00:00.000Z"
    }
  ],
  "deliveryInfo": {
    "estimatedDate": "2024-01-15T00:00:00.000Z",
    "trackingNumber": "1Z999AA1234567890",
    "carrier": "UPS",
    "service": "ground",
    "status": "shipped"
  },
  "createdAt": "2024-01-01T10:30:00.000Z",
  "updatedAt": "2024-01-01T11:00:00.000Z"
}
```

**Status Values:**
- **pending**: Order created, awaiting processing
- **assigned**: Order assigned to operator
- **in_progress**: Operator processing order
- **confirmed**: Customer confirmed order
- **rejected**: Customer rejected order
- **cancelled**: Order cancelled
- **shipped**: Order shipped
- **delivered**: Order delivered

**Error Responses:**
- `401`: Invalid or missing API key
- `404`: Order not found
- `500`: Server error

---

### 3. Sync Products (External)
**POST** `/products/sync`

Triggers product synchronization from connected e-commerce platform.

**Required Authentication:** Valid API key

**Request Body:**
```json
{
  "platform": "shopify",
  "options": {
    "fullSync": false,
    "categories": ["electronics", "accessories"],
    "updatedSince": "2024-01-01T00:00:00.000Z"
  }
}
```

**Response (200):**
```json
{
  "message": "Products synced successfully",
  "syncId": "sync_12345",
  "results": {
    "totalProcessed": 150,
    "newProducts": 25,
    "updatedProducts": 120,
    "skippedProducts": 5,
    "errors": 0
  },
  "syncTime": "2024-01-01T10:30:00.000Z",
  "estimatedCompletion": "2024-01-01T10:35:00.000Z"
}
```

**Sync Options:**
- **fullSync**: Complete product catalog sync
- **categories**: Sync specific product categories
- **updatedSince**: Sync products updated after date
- **includeImages**: Include product images in sync

**Supported Platforms:**
- **shopify**: Shopify store integration
- **woocommerce**: WooCommerce store integration

**Error Responses:**
- `401`: Invalid or missing API key
- `400`: Unsupported platform or invalid options
- `500`: Sync error

---

### 4. Add Product (External)
**POST** `/products`

Adds a new product to the shop's catalog via external API.

**Required Authentication:** Valid API key

**Request Body:**
```json
{
  "name": "New Product",
  "description": "Product description",
  "price": 99.99,
  "sku": "NEW-PROD-001",
  "category": "Electronics",
  "images": [
    "https://example.com/product-image.jpg"
  ],
  "url": "https://shop.com/new-product",
  "inventory": {
    "quantity": 100,
    "trackInventory": true,
    "lowStockThreshold": 10
  },
  "attributes": {
    "brand": "MyBrand",
    "color": "Black",
    "weight": "0.5kg"
  }
}
```

**Response (201):**
```json
{
  "_id": "product_id",
  "name": "New Product",
  "description": "Product description",
  "price": 99.99,
  "sku": "NEW-PROD-001",
  "category": "Electronics",
  "images": [
    "https://example.com/product-image.jpg"
  ],
  "url": "https://shop.com/new-product",
  "shopId": "shop_id",
  "platform": "external",
  "inventory": {
    "quantity": 100,
    "inStock": true,
    "trackInventory": true,
    "lowStockThreshold": 10
  },
  "attributes": {
    "brand": "MyBrand",
    "color": "Black",
    "weight": "0.5kg"
  },
  "isActive": true,
  "createdAt": "2024-01-01T10:30:00.000Z",
  "updatedAt": "2024-01-01T10:30:00.000Z"
}
```

**Error Responses:**
- `401`: Invalid or missing API key
- `400`: Invalid product data or duplicate SKU
- `500`: Server error

## API Key Authentication

### API Key Generation
API keys are generated when a shop is created and can be regenerated through the shop management interface.

### API Key Validation
```javascript
// Validate API key middleware
const apiAuth = async (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const shop = await shopIntegrationService.validateApiKey(apiKey);
    if (!shop) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.shop = shop;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};
```

### Security Features
- **Unique Keys**: Each shop has a unique API key
- **Key Rotation**: API keys can be regenerated
- **Rate Limiting**: API calls are rate limited per key
- **Access Logging**: All API calls are logged for security

## Rate Limiting

### Default Limits
- **Requests per minute**: 100
- **Requests per hour**: 1000
- **Requests per day**: 10000

### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

### Rate Limit Exceeded Response
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfter": 60
}
```

## Subscription Integration

### Limit Checking
Before processing requests, the system checks subscription limits:
- **Order Creation**: Checks monthly order limits
- **Product Sync**: Checks product catalog limits
- **API Calls**: Checks API usage limits

### Limit Exceeded Response
```json
{
  "error": "Subscription limit exceeded",
  "message": "Monthly order limit reached. Please upgrade your plan.",
  "currentUsage": 150,
  "limit": 100,
  "upgradeUrl": "https://app.confirmed.com/upgrade"
}
```

## Error Handling

### Standard Error Format
```json
{
  "error": "Error type",
  "message": "Human readable error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Specific field error"
  },
  "timestamp": "2024-01-01T10:30:00.000Z"
}
```

### Common Error Codes
- **INVALID_API_KEY**: API key is invalid or missing
- **RATE_LIMIT_EXCEEDED**: Too many requests
- **SUBSCRIPTION_LIMIT_EXCEEDED**: Subscription limits reached
- **VALIDATION_ERROR**: Request data validation failed
- **RESOURCE_NOT_FOUND**: Requested resource not found
- **INTERNAL_ERROR**: Server error

## Integration Examples

### cURL Example
```bash
# Create order
curl -X POST http://localhost:3000/external-api/orders \
  -H "X-API-Key: your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "EXT-001",
    "clientInfo": {
      "name": "John Doe",
      "phone": "+1234567890",
      "email": "john@example.com"
    },
    "items": [
      {
        "name": "Product",
        "quantity": 1,
        "price": 99.99,
        "sku": "PROD-001"
      }
    ],
    "totalAmount": 99.99
  }'
```

### JavaScript Example
```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:3000/external-api',
  headers: {
    'X-API-Key': 'your_api_key_here',
    'Content-Type': 'application/json'
  }
});

// Create order
const createOrder = async (orderData) => {
  try {
    const response = await api.post('/orders', orderData);
    return response.data;
  } catch (error) {
    console.error('Error creating order:', error.response.data);
    throw error;
  }
};

// Get order status
const getOrderStatus = async (orderId) => {
  try {
    const response = await api.get(`/orders/${orderId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting order:', error.response.data);
    throw error;
  }
};
```

## Best Practices

### API Usage
- **Store API Keys Securely**: Never expose API keys in client-side code
- **Handle Rate Limits**: Implement proper retry logic with exponential backoff
- **Validate Responses**: Always check response status and handle errors
- **Use HTTPS**: Always use HTTPS in production environments

### Error Handling
- **Retry Logic**: Implement retry logic for transient errors
- **Logging**: Log all API interactions for debugging
- **Monitoring**: Monitor API usage and error rates
- **Alerting**: Set up alerts for high error rates or failures

### Performance
- **Batch Requests**: Use batch operations when available
- **Caching**: Cache responses when appropriate
- **Pagination**: Use pagination for large result sets
- **Compression**: Use gzip compression for large payloads