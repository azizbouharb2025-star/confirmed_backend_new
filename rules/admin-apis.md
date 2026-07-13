# Admin APIs

Base URL: `http://localhost:3000/api/admin`

## Overview
Admin APIs provide comprehensive system management capabilities including dashboard analytics, user management, and system monitoring for administrators.

## Authentication
All endpoints require JWT authentication with `admin` role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Dashboard Analytics
**GET** `/dashboard`

Retrieves comprehensive system-wide analytics and metrics for the admin dashboard.

**Required Role:** `admin`

**Response (200):**
```json
{
  "totalShops": 45,
  "totalOrders": 1250,
  "totalOperators": 12,
  "activeSubscriptions": 38,
  "todayOrders": 85,
  "confirmationRate": 82.5,
  "systemHealth": {
    "status": "healthy",
    "uptime": 2592000,
    "lastRestart": "2024-01-01T00:00:00.000Z"
  },
  "revenueMetrics": {
    "monthlyRevenue": 15750.00,
    "yearlyRevenue": 189000.00,
    "averageOrderValue": 125.50
  },
  "performanceMetrics": {
    "averageResponseTime": 1.2,
    "systemLoad": 0.65,
    "errorRate": 0.02
  }
}
```

**Metrics Included:**
- **Total Shops**: Number of active shops in system
- **Total Orders**: All orders processed
- **Total Operators**: Active operators count
- **Active Subscriptions**: Currently active paid subscriptions
- **Today Orders**: Orders created today
- **Confirmation Rate**: Overall system confirmation rate
- **System Health**: Server status and uptime
- **Revenue Metrics**: Financial performance data
- **Performance Metrics**: System performance indicators

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions
- `500`: Server error

---

### 2. Get Users
**GET** `/users`

Retrieves paginated list of all system users with filtering options.

**Required Role:** `admin`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `role` (optional): Filter by user role

**Example:** `/api/admin/users?page=1&limit=10&role=operator`

**Response (200):**
```json
{
  "users": [
    {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "shop_owner",
      "isActive": true,
      "shopId": {
        "_id": "shop_id",
        "name": "John's Store",
        "domain": "johnstore.com",
        "platform": "shopify"
      },
      "lastLogin": "2024-01-01T10:30:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "stats": {
        "totalOrders": 150,
        "confirmationRate": 85.5
      }
    },
    {
      "_id": "operator_id",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "role": "operator",
      "isActive": true,
      "shopId": null,
      "lastLogin": "2024-01-01T09:15:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "stats": {
        "totalCalls": 500,
        "confirmationRate": 88.2
      }
    }
  ],
  "totalPages": 5,
  "currentPage": 1,
  "totalUsers": 47
}
```

**Features:**
- **Pagination**: Efficient handling of large user lists
- **Role Filtering**: Filter users by specific roles
- **Shop Association**: Shows linked shop information
- **Activity Status**: User active/inactive status
- **Performance Stats**: User-specific performance metrics

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions
- `500`: Server error

---

### 3. Toggle User Status
**PATCH** `/users/:id/toggle-status`

Activates or deactivates a user account.

**Required Role:** `admin`

**URL Parameters:**
- `id`: User ID to toggle status

**Response (200):**
```json
{
  "message": "User activated"
}
```

**Response (200) - Deactivation:**
```json
{
  "message": "User deactivated"
}
```

**Features:**
- **Account Control**: Enable/disable user access
- **Security Management**: Prevent unauthorized access
- **Audit Trail**: Status changes are logged
- **Immediate Effect**: Changes take effect immediately

**Error Responses:**
- `403`: Insufficient permissions
- `404`: User not found
- `500`: Server error

## Dashboard Analytics Details

### System Metrics
- **Uptime**: Server uptime in seconds
- **System Load**: Current CPU/memory usage
- **Error Rate**: Percentage of failed requests
- **Response Time**: Average API response time

### Business Metrics
- **Revenue Tracking**: Monthly and yearly revenue
- **Order Analytics**: Order volume and trends
- **Confirmation Rates**: Success rates across system
- **Growth Metrics**: User and shop growth rates

### Performance Indicators
- **Queue Length**: Current pending orders
- **Operator Efficiency**: Average operator performance
- **System Health**: Overall system status
- **Resource Usage**: Server resource utilization

## User Management Features

### User Roles Management
- **Role Assignment**: Assign/change user roles
- **Permission Control**: Role-based access control
- **Bulk Operations**: Manage multiple users
- **Activity Monitoring**: Track user activity

### Account Status Control
- **Activation/Deactivation**: Control user access
- **Suspension**: Temporary account suspension
- **Password Reset**: Admin-initiated password resets
- **Security Flags**: Mark suspicious accounts

### User Analytics
- **Login Tracking**: Last login timestamps
- **Performance Metrics**: User-specific statistics
- **Activity Logs**: User action history
- **Resource Usage**: Per-user resource consumption

## Security Features

### Access Control
- **Admin-only Access**: Restricted to admin users
- **Audit Logging**: All admin actions logged
- **Session Management**: Secure session handling
- **IP Restrictions**: Optional IP-based access control

### Data Protection
- **Sensitive Data Masking**: Hide sensitive information
- **Secure Transmission**: HTTPS encryption
- **Data Validation**: Input validation and sanitization
- **Rate Limiting**: Prevent abuse and attacks

## Integration Points

- **Analytics Service**: Real-time metrics calculation
- **User Service**: User management operations
- **Subscription Service**: Billing and subscription data
- **Monitoring Service**: System health monitoring
- **Audit Service**: Action logging and compliance