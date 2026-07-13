# Operators APIs

Base URL: `http://localhost:3000/api/operators`

## Overview
Operator APIs provide functionality for call center operators to manage order confirmations, retrieve assigned orders, and view performance statistics.

## Authentication
All endpoints require JWT authentication with `operator` role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Next Order
**GET** `/next-order`

Retrieves and assigns the next available order from the queue to the operator.

**Required Role:** `operator`

**Response (200) - Order Available:**
```json
{
  "_id": "order_id",
  "orderId": "ORDER-001",
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
      "name": "Product 1",
      "quantity": 2,
      "price": 29.99,
      "sku": "PROD-001",
      "url": "https://shop.com/product-1"
    }
  ],
  "totalAmount": 59.98,
  "status": "assigned",
  "priority": "normal",
  "deliveryInfo": {
    "estimatedDate": "2024-01-15T00:00:00.000Z",
    "trackingNumber": "TRACK123",
    "carrier": "UPS"
  },
  "assignedOperatorId": "operator_id",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Response (200) - No Orders Available:**
```json
{
  "message": "No orders available"
}
```

**Features:**
- Automatic order assignment to requesting operator
- Queue-based order distribution (FIFO with priority)
- Status update to "assigned"
- Prevents duplicate assignments

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions (not an operator)
- `500`: Server error

---

### 2. Get Operator Stats
**GET** `/stats`

Retrieves performance statistics and metrics for the authenticated operator.

**Required Role:** `operator`

**Response (200):**
```json
{
  "operatorId": "operator_id",
  "totalCalls": 150,
  "confirmedOrders": 120,
  "rejectedOrders": 25,
  "noAnswerCalls": 5,
  "confirmationRate": 80.0,
  "averageCallDuration": 180,
  "todayStats": {
    "totalCalls": 12,
    "confirmedOrders": 10,
    "rejectedOrders": 2,
    "confirmationRate": 83.3
  },
  "weeklyStats": {
    "totalCalls": 75,
    "confirmedOrders": 60,
    "rejectedOrders": 12,
    "confirmationRate": 80.0
  },
  "monthlyStats": {
    "totalCalls": 300,
    "confirmedOrders": 240,
    "rejectedOrders": 45,
    "confirmationRate": 80.0
  },
  "queueLength": 25,
  "lastCallTime": "2024-01-01T10:30:00.000Z",
  "activeTime": 28800,
  "performance": {
    "rank": 3,
    "totalOperators": 10,
    "efficiency": "high"
  }
}
```

**Metrics Included:**
- **Total Calls**: All calls made by operator
- **Confirmed Orders**: Successfully confirmed orders
- **Rejected Orders**: Orders rejected by customers
- **No Answer Calls**: Calls with no customer response
- **Confirmation Rate**: Percentage of successful confirmations
- **Average Call Duration**: Average time per call (seconds)
- **Queue Length**: Current number of pending orders
- **Performance Ranking**: Operator ranking among peers

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions
- `500`: Server error

## Queue Management

### Order Assignment Logic
1. **Priority-based**: High priority orders assigned first
2. **FIFO**: First-in-first-out for same priority orders
3. **Load Balancing**: Even distribution among available operators
4. **Availability Check**: Only assigns to active operators

### Queue Status Updates
- **pending** → **assigned**: When operator gets next order
- **assigned** → **in_progress**: When operator starts processing
- **in_progress** → **confirmed/rejected**: Based on call outcome

## Performance Metrics

### Confirmation Rate Calculation
```
Confirmation Rate = (Confirmed Orders / Total Calls) × 100
```

### Efficiency Ratings
- **high**: >85% confirmation rate
- **medium**: 70-85% confirmation rate
- **low**: <70% confirmation rate

### Time Tracking
- **Active Time**: Total time operator was online
- **Call Duration**: Time spent on each call
- **Response Time**: Time to pick up assigned orders

## Operator Workflow

1. **Login**: Operator authenticates with credentials
2. **Get Next Order**: Request next available order from queue
3. **Process Order**: Contact customer to confirm order details
4. **Update Status**: Mark order as confirmed/rejected with notes
5. **Repeat**: Continue processing orders from queue

## Real-time Features

- **Live Queue Updates**: Real-time queue length monitoring
- **Instant Assignment**: Immediate order assignment when available
- **Performance Tracking**: Real-time statistics updates
- **Status Synchronization**: Live status updates across system

## Integration Points

- **Redis Queue**: Order queue management
- **Call History**: Automatic call logging
- **Analytics Service**: Performance metrics calculation
- **Notification Service**: Real-time updates and alerts