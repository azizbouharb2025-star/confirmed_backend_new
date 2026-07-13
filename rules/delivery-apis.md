# Delivery APIs

Base URL: `http://localhost:3000/api/delivery`

## Overview
Delivery management APIs handle shipping integrations, tracking, and logistics operations. Currently supports Aramex integration with extensible architecture for additional carriers.

## Authentication
All endpoints require JWT authentication.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Setup Delivery Integration
**POST** `/integration`

Configures delivery service integration for a shop.

**Required Role:** Any authenticated user

**Request Body:**
```json
{
  "platform": "aramex",
  "credentials": {
    "username": "aramex_username",
    "password": "aramex_password",
    "accountNumber": "12345678",
    "accountPin": "123456",
    "accountEntity": "AMM",
    "accountCountryCode": "JO",
    "version": "v1.0"
  },
  "settings": {
    "defaultService": "express",
    "cashOnDelivery": true,
    "insuranceEnabled": false,
    "signatureRequired": true,
    "defaultWeight": 1.0,
    "defaultDimensions": {
      "length": 10,
      "width": 10,
      "height": 5
    }
  }
}
```

**Response (201):**
```json
{
  "_id": "integration_id",
  "shopId": "shop_id",
  "platform": "aramex",
  "credentials": {
    "username": "aramex_username",
    "accountNumber": "12345678",
    "accountEntity": "AMM",
    "accountCountryCode": "JO",
    "version": "v1.0"
  },
  "settings": {
    "defaultService": "express",
    "cashOnDelivery": true,
    "insuranceEnabled": false,
    "signatureRequired": true,
    "defaultWeight": 1.0,
    "defaultDimensions": {
      "length": 10,
      "width": 10,
      "height": 5
    }
  },
  "isActive": true,
  "lastSync": null,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Supported Platforms:**
- **aramex**: Aramex shipping services
- **dhl**: DHL Express (future)
- **fedex**: FedEx services (future)
- **ups**: UPS services (future)

**Error Responses:**
- `400`: Invalid platform or credentials
- `401`: Unauthorized
- `500`: Server error

---

### 2. Get Delivery Integrations
**GET** `/integrations`

Retrieves all configured delivery integrations for the shop.

**Required Role:** Any authenticated user

**Response (200):**
```json
[
  {
    "_id": "integration_id",
    "shopId": "shop_id",
    "platform": "aramex",
    "settings": {
      "defaultService": "express",
      "cashOnDelivery": true,
      "insuranceEnabled": false,
      "signatureRequired": true,
      "defaultWeight": 1.0,
      "defaultDimensions": {
        "length": 10,
        "width": 10,
        "height": 5
      }
    },
    "isActive": true,
    "lastSync": "2024-01-01T10:30:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "status": {
      "connected": true,
      "lastError": null,
      "shipmentsCreated": 150,
      "successRate": 98.5
    }
  }
]
```

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

### 3. Create Shipment
**POST** `/shipment/:orderId`

Creates a shipment for a specific order using the configured delivery service.

**Required Role:** Any authenticated user

**URL Parameters:**
- `orderId`: Order ID to create shipment for

**Request Body (Optional):**
```json
{
  "service": "express",
  "cashOnDelivery": true,
  "insurance": {
    "enabled": true,
    "value": 100.00
  },
  "specialInstructions": "Handle with care",
  "deliveryOptions": {
    "signatureRequired": true,
    "leaveAtDoor": false,
    "callBeforeDelivery": true
  }
}
```

**Response (200):**
```json
{
  "trackingNumber": "12345678901234567890",
  "shipmentId": "aramex_shipment_123",
  "carrier": "aramex",
  "service": "express",
  "estimatedDelivery": "2024-01-05T00:00:00.000Z",
  "cost": {
    "amount": 15.50,
    "currency": "USD"
  },
  "labels": [
    {
      "type": "shipping_label",
      "url": "https://aramex.com/labels/123456.pdf",
      "format": "pdf"
    }
  ],
  "shipmentDetails": {
    "weight": 1.5,
    "dimensions": {
      "length": 15,
      "width": 12,
      "height": 8
    },
    "cashOnDelivery": true,
    "codAmount": 59.98,
    "insurance": {
      "enabled": true,
      "value": 100.00
    }
  },
  "createdAt": "2024-01-01T10:30:00.000Z"
}
```

**Features:**
- **Automatic Label Generation**: PDF shipping labels
- **COD Support**: Cash on delivery handling
- **Insurance Options**: Package insurance
- **Service Selection**: Express, standard, economy
- **Cost Calculation**: Real-time shipping costs

**Error Responses:**
- `400`: Invalid order or shipment data
- `401`: Unauthorized
- `404`: Order not found
- `500`: Server error or carrier API failure

---

### 4. Track Shipment
**GET** `/track/:orderId`

Retrieves tracking information for a shipment associated with an order.

**Required Role:** Any authenticated user

**URL Parameters:**
- `orderId`: Order ID to track

**Response (200):**
```json
{
  "orderId": "ORDER-001",
  "trackingNumber": "12345678901234567890",
  "carrier": "aramex",
  "status": "in_transit",
  "estimatedDelivery": "2024-01-05T00:00:00.000Z",
  "currentLocation": {
    "city": "Dubai",
    "country": "UAE",
    "facility": "Dubai Distribution Center"
  },
  "trackingHistory": [
    {
      "status": "picked_up",
      "description": "Package picked up from sender",
      "location": "Amman, Jordan",
      "timestamp": "2024-01-01T10:30:00.000Z"
    },
    {
      "status": "in_transit",
      "description": "Package in transit to destination",
      "location": "Dubai, UAE",
      "timestamp": "2024-01-02T08:15:00.000Z"
    },
    {
      "status": "out_for_delivery",
      "description": "Package out for delivery",
      "location": "Dubai, UAE",
      "timestamp": "2024-01-03T09:00:00.000Z"
    }
  ],
  "deliveryAttempts": [
    {
      "attemptNumber": 1,
      "timestamp": "2024-01-03T14:30:00.000Z",
      "status": "failed",
      "reason": "Customer not available",
      "nextAttempt": "2024-01-04T10:00:00.000Z"
    }
  ],
  "lastUpdated": "2024-01-03T14:30:00.000Z"
}
```

**Tracking Status Values:**
- **pending**: Shipment created, awaiting pickup
- **picked_up**: Package collected from sender
- **in_transit**: Package in transit
- **out_for_delivery**: Package out for delivery
- **delivered**: Package successfully delivered
- **failed_delivery**: Delivery attempt failed
- **returned**: Package returned to sender
- **cancelled**: Shipment cancelled

**Error Responses:**
- `401`: Unauthorized
- `404`: Order or tracking information not found
- `500`: Server error or carrier API failure

## Aramex Integration

### API Endpoints Used
- **CreateShipments**: Create new shipments
- **TrackShipments**: Track shipment status
- **CalculateRate**: Calculate shipping costs
- **PrintLabel**: Generate shipping labels

### Authentication
- **Username/Password**: Aramex account credentials
- **Account Details**: Account number, PIN, entity, country code
- **Version**: API version (currently v1.0)

### Services Supported
- **Express**: Next-day delivery
- **Standard**: 2-3 day delivery
- **Economy**: 5-7 day delivery
- **International**: Cross-border shipping

### Features
- **Cash on Delivery (COD)**: Collect payment on delivery
- **Insurance**: Package insurance coverage
- **Signature Required**: Require recipient signature
- **Tracking**: Real-time package tracking
- **Label Generation**: PDF shipping labels

## Delivery Service Configuration

### Default Settings
- **Service Type**: Express, standard, or economy
- **Weight**: Default package weight
- **Dimensions**: Default package dimensions
- **COD**: Cash on delivery enabled/disabled
- **Insurance**: Insurance coverage settings
- **Signature**: Signature requirement

### Advanced Options
- **Special Instructions**: Delivery instructions
- **Delivery Window**: Preferred delivery time
- **Notification Settings**: SMS/email notifications
- **Return Policy**: Return handling preferences

## Cost Calculation

### Factors Affecting Cost
- **Weight**: Package weight in kg
- **Dimensions**: Length, width, height in cm
- **Distance**: Origin to destination distance
- **Service Type**: Express vs standard pricing
- **Additional Services**: COD, insurance, signature

### Pricing Structure
- **Base Rate**: Minimum shipping cost
- **Weight Charges**: Per kg pricing
- **Dimensional Weight**: Volumetric weight calculation
- **Service Fees**: Additional service charges
- **Fuel Surcharge**: Variable fuel costs

## Error Handling

### Common Errors
- **Invalid Address**: Incorrect delivery address
- **Service Unavailable**: Service not available in area
- **Weight Exceeded**: Package exceeds weight limits
- **API Limits**: Carrier API rate limits
- **Authentication Failed**: Invalid credentials

### Retry Logic
- **Automatic Retries**: Retry failed requests
- **Exponential Backoff**: Increasing retry delays
- **Circuit Breaker**: Prevent cascade failures
- **Fallback Options**: Alternative carriers

## Webhook Integration

### Delivery Status Updates
- **Status Changes**: Real-time status updates
- **Delivery Confirmation**: Successful delivery notifications
- **Exception Handling**: Delivery issues and delays
- **Return Processing**: Return shipment handling

### Event Types
- **shipment.created**: New shipment created
- **shipment.picked_up**: Package picked up
- **shipment.in_transit**: Package in transit
- **shipment.delivered**: Package delivered
- **shipment.exception**: Delivery exception occurred

## Future Enhancements

### Additional Carriers
- **DHL Express**: International express delivery
- **FedEx**: Global shipping services
- **UPS**: United Parcel Service integration
- **Local Carriers**: Regional delivery services

### Advanced Features
- **Multi-carrier Shipping**: Compare rates across carriers
- **Delivery Optimization**: Route optimization
- **Returns Management**: Automated return processing
- **Analytics Dashboard**: Shipping performance metrics