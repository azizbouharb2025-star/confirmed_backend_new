# Shops APIs

Base URL: `http://localhost:3000/api/shops`

## Overview
Shop management APIs handle e-commerce store integration, configuration, and settings. Supports Shopify, WooCommerce, Meta, Converty, TiktakPro, and custom platforms.

## Authentication
All endpoints require JWT authentication with appropriate role permissions.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Create Shop
**POST** `/`

Creates a new shop with platform integration and default subscription.

**Required Role:** `shop_owner`

**Request Body:**
```json
{
  "name": "My E-commerce Store",
  "domain": "mystore.com",
  "platform": "shopify", // "shopify", "woocommerce", "meta", "converty", "tiktakpro", "custom"
  "apiCredentials": {
    "apiKey": "test-api-key",
    "apiSecret": "test-api-secret",
    "accessToken": "test-access-token",
    "webhookSecret": "webhook-secret"
  }
}
```

**Response (201):**
```json
{
  "_id": "shop_id",
  "name": "My E-commerce Store",
  "domain": "mystore.com",
  "platform": "shopify",
  "apiCredentials": {
    "apiKey": "test-api-key",
    "apiSecret": "test-api-secret",
    "accessToken": "test-access-token",
    "webhookSecret": "webhook-secret"
  },
  "subscriptionId": "subscription_id",
  "isActive": true,
  "settings": {
    "callPriority": "normal",
    "productSyncEnabled": true,
    "webhookEnabled": true
  },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Features:**
- Automatically creates free subscription plan
- Links shop to authenticated user
- Validates platform-specific credentials

**Error Responses:**
- `400`: Invalid request data or validation errors
- `403`: Insufficient permissions
- `500`: Server error

---

### 2. Get Shops
**GET** `/`

Retrieves shops based on user role and permissions.

**Required Role:** Any authenticated user

**Query Parameters:**
- None

**Response (200):**
```json
[
  {
    "_id": "shop_id",
    "name": "My E-commerce Store",
    "domain": "mystore.com",
    "platform": "shopify",
    "subscriptionId": {
      "_id": "subscription_id",
      "plan": "free",
      "status": "active",
      "features": {
        "maxOperators": 1,
        "maxAICalls": 10,
        "maxShops": 1,
        "prioritySupport": false,
        "customIntegrations": false
      }
    },
    "isActive": true,
    "settings": {
      "callPriority": "normal",
      "productSyncEnabled": true,
      "webhookEnabled": true
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Access Control:**
- **Admin**: Can view all shops
- **Shop Owner**: Can only view their own shop
- **Operator**: Can view assigned shops

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

### 3. Update Shop Settings
**PATCH** `/:id/settings`

Updates shop configuration and settings.

**Required Role:** `shop_owner`

**URL Parameters:**
- `id`: Shop ID

**Request Body:**
```json
{
  "settings": {
    "callPriority": "high", // "low", "normal", "high"
    "productSyncEnabled": false,
    "webhookEnabled": true,
    "aiCallsEnabled": true,
    "confirmationTimeout": 300,
    "maxRetries": 3
  }
}
```

**Response (200):**
```json
{
  "_id": "shop_id",
  "name": "My E-commerce Store",
  "domain": "mystore.com",
  "platform": "shopify",
  "settings": {
    "callPriority": "high",
    "productSyncEnabled": false,
    "webhookEnabled": true,
    "aiCallsEnabled": true,
    "confirmationTimeout": 300,
    "maxRetries": 3
  },
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Responses:**
- `400`: Invalid settings data
- `403`: Insufficient permissions
- `404`: Shop not found
- `500`: Server error

## Platform Integration

### Shopify Integration
- **API Credentials**: API Key, API Secret, Access Token
- **Webhook Support**: Order creation, updates
- **Product Sync**: Automatic product synchronization
- **Domain Validation**: Shopify store domain verification

### WooCommerce Integration
- **API Credentials**: Consumer Key, Consumer Secret, Store URL
- **REST API**: WooCommerce REST API v3
- **Product Sync**: Manual and automatic sync
- **Webhook Support**: Order status updates

### Meta Integration
- **API Credentials**: App ID, App Secret, Page ID
- **Business Manager**: Facebook/Instagram business account connection
- **Catalog Sync**: Product catalog synchronization
- **Webhook Support**: Order and catalog updates

### Converty Integration
- **API Credentials**: API Key, API Secret, Store URL
- **Product Sync**: Automatic product synchronization
- **Webhook Support**: Order creation and status updates

### TiktakPro Integration
- **API Credentials**: API Key, API Secret, Shop ID
- **Seller Account**: TiktakPro seller account connection
- **Product Sync**: Shop and product synchronization
- **Webhook Support**: Order webhook notifications

### Custom Platform
- **Flexible Integration**: Custom API endpoints
- **Manual Configuration**: Custom webhook URLs
- **API Key Authentication**: Custom API key management

## Default Subscription Features

When creating a shop, a free subscription is automatically created with:
- **Max Operators**: 1
- **Max AI Calls**: 10 per month
- **Max Shops**: 1
- **Priority Support**: No
- **Custom Integrations**: No

## Shop Settings Options

- **callPriority**: Order processing priority (low, normal, high)
- **productSyncEnabled**: Automatic product synchronization
- **webhookEnabled**: Webhook processing
- **aiCallsEnabled**: AI-powered order confirmation
- **confirmationTimeout**: Timeout for order confirmation (seconds)
- **maxRetries**: Maximum retry attempts for failed calls