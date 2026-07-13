# Webhooks APIs

Base URL: `http://localhost:3000/api/webhooks`

## Overview
Webhook APIs handle real-time event notifications from external platforms and services. Supports Shopify webhooks and generic order status updates for seamless integration.

## Authentication
Webhook endpoints use platform-specific authentication methods rather than JWT tokens.

## Endpoints

### 1. Shopify Order Webhook
**POST** `/shopify/orders`

Receives new order notifications from Shopify stores.

**Authentication:** Shopify webhook verification via shop domain header

**Headers:**
```
X-Shopify-Shop-Domain: mystore.myshopify.com
X-Shopify-Topic: orders/create
X-Shopify-Hmac-Sha256: webhook_signature
```

**Request Body (Shopify Order Format):**
```json
{
  "id": 450789469,
  "email": "customer@example.com",
  "created_at": "2024-01-01T10:30:00-05:00",
  "updated_at": "2024-01-01T10:30:00-05:00",
  "number": 1001,
  "note": null,
  "token": "b1946ac92492d2347c6235b4d2611184",
  "gateway": "shopify_payments",
  "test": false,
  "total_price": "199.98",
  "subtotal_price": "199.98",
  "total_weight": 0,
  "total_tax": "0.00",
  "taxes_included": false,
  "currency": "USD",
  "financial_status": "paid",
  "confirmed": true,
  "total_discounts": "0.00",
  "customer": {
    "id": 207119551,
    "email": "customer@example.com",
    "accepts_marketing": false,
    "created_at": "2024-01-01T10:30:00-05:00",
    "updated_at": "2024-01-01T10:30:00-05:00",
    "first_name": "John",
    "last_name": "Doe",
    "orders_count": 1,
    "state": "disabled",
    "total_spent": "199.98",
    "last_order_id": 450789469,
    "note": null,
    "verified_email": true,
    "multipass_identifier": null,
    "tax_exempt": false,
    "phone": "+1234567890",
    "tags": "",
    "last_order_name": "#1001"
  },
  "billing_address": {
    "first_name": "John",
    "address1": "123 Main St",
    "phone": "+1234567890",
    "city": "New York",
    "zip": "10001",
    "province": "New York",
    "country": "United States",
    "last_name": "Doe",
    "address2": null,
    "company": null,
    "latitude": 40.7128,
    "longitude": -74.0060,
    "name": "John Doe",
    "country_code": "US",
    "province_code": "NY"
  },
  "shipping_address": {
    "first_name": "John",
    "address1": "123 Main St",
    "phone": "+1234567890",
    "city": "New York",
    "zip": "10001",
    "province": "New York",
    "country": "United States",
    "last_name": "Doe",
    "address2": null,
    "company": null,
    "latitude": 40.7128,
    "longitude": -74.0060,
    "name": "John Doe",
    "country_code": "US",
    "province_code": "NY"
  },
  "line_items": [
    {
      "id": 866550311766439020,
      "variant_id": 808950810,
      "title": "Premium Headphones",
      "quantity": 1,
      "sku": "HEADPHONES-001",
      "variant_title": null,
      "vendor": "MyStore",
      "fulfillment_service": "manual",
      "product_id": 632910392,
      "requires_shipping": true,
      "taxable": true,
      "gift_card": false,
      "name": "Premium Headphones",
      "variant_inventory_management": "shopify",
      "properties": [],
      "product_exists": true,
      "fulfillable_quantity": 1,
      "grams": 500,
      "price": "199.98",
      "total_discount": "0.00",
      "fulfillment_status": null,
      "price_set": {
        "shop_money": {
          "amount": "199.98",
          "currency_code": "USD"
        }
      },
      "total_discount_set": {
        "shop_money": {
          "amount": "0.00",
          "currency_code": "USD"
        }
      }
    }
  ]
}
```

**Response (200):**
```json
{
  "message": "Order processed",
  "orderId": "internal_order_id",
  "queuePosition": 5
}
```

**Processing Flow:**
1. **Verify Shop**: Validate shop domain against registered shops
2. **Create Order**: Convert Shopify order to internal format
3. **Extract Data**: Parse customer info, items, and addresses
4. **Queue Addition**: Add order to call queue for processing
5. **Logging**: Log webhook receipt and processing

**Error Responses:**
- `404`: Shop not found for domain
- `400`: Invalid webhook data
- `500`: Processing error

---

### 2. Generic Order Status Webhook
**POST** `/order-status`

Receives order status updates from external systems or manual integrations.

**Authentication:** API key or webhook signature verification

**Request Body:**
```json
{
  "orderId": "ORDER-001",
  "shopId": "shop_id",
  "status": "confirmed",
  "deliveryInfo": {
    "trackingNumber": "TRACK123456",
    "carrier": "UPS",
    "estimatedDelivery": "2024-01-05T00:00:00.000Z",
    "actualDelivery": null,
    "deliveryStatus": "in_transit"
  },
  "notes": "Customer confirmed order via phone",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "source": "external_system"
}
```

**Response (200):**
```json
{
  "message": "Order status updated",
  "orderId": "ORDER-001",
  "previousStatus": "pending",
  "newStatus": "confirmed",
  "updatedAt": "2024-01-01T10:30:00.000Z"
}
```

**Supported Status Values:**
- **pending**: Order awaiting processing
- **confirmed**: Order confirmed by customer
- **rejected**: Order rejected by customer
- **cancelled**: Order cancelled
- **shipped**: Order shipped
- **delivered**: Order delivered
- **returned**: Order returned

**Error Responses:**
- `404`: Order not found
- `400`: Invalid status or data
- `500`: Update error

## Webhook Security

### Shopify Webhook Verification
```javascript
// Verify webhook authenticity
const crypto = require('crypto');

function verifyShopifyWebhook(data, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data, 'utf8');
  const hash = hmac.digest('base64');
  return hash === signature;
}
```

### Generic Webhook Authentication
- **API Key**: Include API key in headers
- **HMAC Signature**: Sign payload with shared secret
- **IP Whitelist**: Restrict to known IP addresses
- **Timestamp Validation**: Prevent replay attacks

## Data Processing

### Shopify Order Transformation
```javascript
// Transform Shopify order to internal format
const transformShopifyOrder = (shopifyOrder) => ({
  orderId: shopifyOrder.id.toString(),
  clientInfo: {
    name: `${shopifyOrder.customer.first_name} ${shopifyOrder.customer.last_name}`,
    phone: shopifyOrder.customer.phone,
    email: shopifyOrder.customer.email,
    address: shopifyOrder.shipping_address
  },
  items: shopifyOrder.line_items.map(item => ({
    name: item.name,
    quantity: item.quantity,
    price: parseFloat(item.price),
    sku: item.sku
  })),
  totalAmount: parseFloat(shopifyOrder.total_price)
});
```

### Queue Integration
- **Redis Queue**: Add processed orders to call queue
- **Priority Handling**: Set priority based on shop settings
- **Batch Processing**: Handle multiple orders efficiently
- **Error Recovery**: Retry failed queue operations

## Event Types

### Shopify Events
- **orders/create**: New order created
- **orders/updated**: Order details updated
- **orders/paid**: Order payment completed
- **orders/cancelled**: Order cancelled
- **orders/fulfilled**: Order fulfilled
- **orders/partially_fulfilled**: Partial fulfillment

### Custom Events
- **order.status_changed**: Order status updated
- **order.assigned**: Order assigned to operator
- **order.confirmed**: Order confirmed by customer
- **order.shipped**: Order shipped
- **order.delivered**: Order delivered

## Error Handling

### Webhook Failures
- **Retry Logic**: Automatic retry for failed webhooks
- **Dead Letter Queue**: Store failed webhooks for manual review
- **Error Logging**: Detailed error logging and monitoring
- **Alerting**: Notify administrators of webhook failures

### Data Validation
- **Schema Validation**: Validate webhook payload structure
- **Required Fields**: Ensure essential data is present
- **Data Types**: Validate field data types
- **Business Rules**: Apply business logic validation

## Monitoring and Analytics

### Webhook Metrics
- **Success Rate**: Percentage of successful webhook processing
- **Response Time**: Average webhook processing time
- **Error Rate**: Frequency of webhook errors
- **Volume**: Number of webhooks received per time period

### Performance Monitoring
- **Queue Length**: Monitor call queue size
- **Processing Time**: Track order processing duration
- **System Load**: Monitor server resource usage
- **Database Performance**: Track database query performance

## Configuration

### Webhook URLs
- **Shopify**: Configure in Shopify admin panel
- **Custom**: Provide webhook URLs to external systems
- **Testing**: Use ngrok or similar for local development
- **Production**: Use HTTPS endpoints with SSL certificates

### Shop Settings
```json
{
  "webhookSettings": {
    "enabled": true,
    "shopifyWebhooks": {
      "orders/create": true,
      "orders/updated": false,
      "orders/cancelled": true
    },
    "customWebhooks": {
      "orderStatus": true,
      "deliveryUpdates": true
    },
    "retrySettings": {
      "maxRetries": 3,
      "retryDelay": 5000
    }
  }
}
```

## Best Practices

### Webhook Design
- **Idempotency**: Handle duplicate webhooks gracefully
- **Async Processing**: Process webhooks asynchronously
- **Quick Response**: Return HTTP 200 quickly
- **Error Handling**: Proper error responses and logging

### Security
- **Signature Verification**: Always verify webhook signatures
- **HTTPS Only**: Use HTTPS for all webhook endpoints
- **Rate Limiting**: Implement rate limiting for webhook endpoints
- **Input Validation**: Validate all incoming webhook data

### Reliability
- **Monitoring**: Monitor webhook health and performance
- **Alerting**: Set up alerts for webhook failures
- **Backup Processing**: Have fallback mechanisms
- **Documentation**: Maintain clear webhook documentation