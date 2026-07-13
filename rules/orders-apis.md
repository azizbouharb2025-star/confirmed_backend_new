# Orders APIs

Base URL: `http://localhost:3000/api/orders`

## Overview
Order management APIs handle order creation, status updates, assignment, and tracking. Integrates with Redis queue system for order processing workflow.

## Authentication
All endpoints require JWT authentication with appropriate role permissions.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Create Order
**POST** `/`

Creates a new order and adds it to the call queue for processing.

**Required Role:** `shop_owner`

**Request Body:**
```json
{
  "orderId": "ORDER-001",
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
      "sku": "PROD-001"
    }
  ],
  "totalAmount": 59.98,
  "deliveryInfo": {
    "estimatedDate": "2024-01-15T00:00:00.000Z",
    "trackingNumber": "TRACK123",
    "carrier": "UPS"
  }
}
```

**Response (201):**
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
      "sku": "PROD-001"
    }
  ],
  "totalAmount": 59.98,
  "status": "pending",
  "priority": "normal",
  "deliveryInfo": {
    "estimatedDate": "2024-01-15T00:00:00.000Z",
    "trackingNumber": "TRACK123",
    "carrier": "UPS"
  },
  "callHistory": [],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Features:**
- Automatic queue addition for processing
- Validation of required fields
- Shop association based on authenticated user

**Error Responses:**
- `400`: Invalid request data or validation errors
- `403`: Insufficient permissions
- `500`: Server error

---

### 2. Get Orders
**GET** `/`

Retrieves orders with pagination and filtering based on user role.

**Required Role:** Any authenticated user

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `status` (optional): Filter by order status

**Example:** `/api/orders?page=1&limit=10&status=pending`

**Response (200):**
```json
{
  "orders": [
    {
      "_id": "order_id",
      "orderId": "ORDER-001",
      "shopId": "shop_id",
      "clientInfo": {
        "name": "John Doe",
        "phone": "+1234567890",
        "email": "john@example.com"
      },
      "items": [
        {
          "name": "Product 1",
          "quantity": 2,
          "price": 29.99,
          "sku": "PROD-001"
        }
      ],
      "totalAmount": 59.98,
      "status": "pending",
      "priority": "normal",
      "assignedOperatorId": {
        "name": "Operator Name",
        "email": "operator@example.com"
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "totalPages": 5,
  "currentPage": 1
}
```

**Access Control:**
- **Shop Owner**: Can view orders from their shop only
- **Admin/Operator**: Can view all orders

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

### 3. Update Order Status
**PATCH** `/:id/status`

Updates order status and adds call history entry.

**Required Role:** Any authenticated user

**URL Parameters:**
- `id`: Order ID

**Request Body:**
```json
{
  "status": "confirmed", // "pending", "confirmed", "rejected", "cancelled"
  "notes": "Customer confirmed the order"
}
```

**Response (200):**
```json
{
  "_id": "order_id",
  "orderId": "ORDER-001",
  "status": "confirmed",
  "callHistory": [
    {
      "operatorId": "operator_id",
      "callType": "human",
      "result": "confirmed",
      "notes": "Customer confirmed the order",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ],
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Features:**
- Automatic call history tracking for operators
- Status validation
- Timestamp recording

**Error Responses:**
- `404`: Order not found
- `500`: Server error

---

### 4. Assign Operator
**PATCH** `/:id/assign`

Assigns an operator to handle the order.

**Required Role:** `admin` or `operator`

**URL Parameters:**
- `id`: Order ID

**Request Body:**
```json
{
  "operatorId": "operator_user_id"
}
```

**Response (200):**
```json
{
  "_id": "order_id",
  "orderId": "ORDER-001",
  "assignedOperatorId": "operator_user_id",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Responses:**
- `403`: Insufficient permissions
- `404`: Order not found
- `500`: Server error

## Order Status Flow

1. **pending**: Initial status when order is created
2. **assigned**: Order assigned to an operator
3. **in_progress**: Operator is processing the order
4. **confirmed**: Customer confirmed the order
5. **rejected**: Customer rejected the order
6. **cancelled**: Order was cancelled

## Order Priority Levels

- **low**: Standard processing
- **normal**: Default priority
- **high**: Priority processing
- **urgent**: Immediate processing

## Call History Tracking

Each status update by an operator automatically creates a call history entry with:
- **operatorId**: ID of the operator making the update
- **callType**: Type of call (human, ai)
- **result**: Outcome (confirmed, rejected, no_answer)
- **notes**: Additional notes from the operator
- **timestamp**: When the call was made

## Queue Integration

Orders are automatically added to Redis queue for processing:
- Queue key: `call_queue`
- Contains: orderId, shopId, priority, timestamp
- FIFO processing with priority handling

## Validation Rules

### Required Fields
- `orderId`: Unique order identifier
- `clientInfo.name`: Customer name
- `clientInfo.phone`: Customer phone number
- `totalAmount`: Order total amount

### Optional Fields
- `clientInfo.email`: Customer email
- `clientInfo.address`: Delivery address
- `items`: Order items array
- `deliveryInfo`: Delivery tracking information