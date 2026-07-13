# Analytics APIs

Base URL: `http://localhost:3000/api/analytics`

## Overview
Analytics APIs provide comprehensive business intelligence, performance metrics, and data insights for shops, operators, and system administrators.

## Authentication
All endpoints require JWT authentication with appropriate role permissions.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Dashboard Metrics
**GET** `/dashboard`

Retrieves comprehensive dashboard metrics based on user role and permissions.

**Required Role:** Any authenticated user

**Response (200):**
```json
{
  "overview": {
    "totalOrders": 1250,
    "confirmedOrders": 1031,
    "rejectedOrders": 156,
    "pendingOrders": 63,
    "confirmationRate": 82.5,
    "averageOrderValue": 125.50
  },
  "timeSeriesData": {
    "daily": [
      {
        "date": "2024-01-01",
        "orders": 45,
        "confirmed": 38,
        "rejected": 5,
        "pending": 2
      }
    ],
    "weekly": [
      {
        "week": "2024-W01",
        "orders": 315,
        "confirmed": 260,
        "rejected": 35,
        "pending": 20
      }
    ],
    "monthly": [
      {
        "month": "2024-01",
        "orders": 1250,
        "confirmed": 1031,
        "rejected": 156,
        "pending": 63
      }
    ]
  },
  "topProducts": [
    {
      "name": "Product A",
      "orders": 150,
      "revenue": 18750.00,
      "confirmationRate": 88.5
    }
  ],
  "revenueMetrics": {
    "totalRevenue": 156875.00,
    "monthlyRevenue": 15750.00,
    "averageOrderValue": 125.50,
    "revenueGrowth": 12.5
  }
}
```

**Access Control:**
- **Shop Owner**: Metrics for their shop only
- **Admin**: System-wide metrics
- **Operator**: Limited metrics for assigned orders

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

### 2. Get Call Efficiency
**GET** `/call-efficiency`

Retrieves detailed call efficiency metrics and performance analytics.

**Required Role:** `shop_owner` or `admin`

**Query Parameters:**
- `days` (optional): Number of days to analyze (default: 30)

**Example:** `/api/analytics/call-efficiency?days=30`

**Response (200):**
```json
{
  "period": {
    "days": 30,
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-30T23:59:59.000Z"
  },
  "overallMetrics": {
    "totalCalls": 850,
    "successfulCalls": 722,
    "failedCalls": 85,
    "noAnswerCalls": 43,
    "successRate": 84.9,
    "averageCallDuration": 185,
    "averageResponseTime": 12.5
  },
  "dailyTrends": [
    {
      "date": "2024-01-01",
      "totalCalls": 28,
      "successfulCalls": 24,
      "successRate": 85.7,
      "averageDuration": 180
    }
  ],
  "hourlyDistribution": [
    {
      "hour": 9,
      "calls": 45,
      "successRate": 88.9
    }
  ],
  "operatorPerformance": [
    {
      "operatorId": "op_001",
      "operatorName": "John Smith",
      "totalCalls": 120,
      "successRate": 89.2,
      "averageDuration": 165,
      "rank": 1
    }
  ],
  "callOutcomes": {
    "confirmed": 722,
    "rejected": 85,
    "noAnswer": 43,
    "busy": 12,
    "voicemail": 8
  }
}
```

**Metrics Included:**
- **Success Rate**: Percentage of successful confirmations
- **Call Duration**: Average time per call
- **Response Time**: Time to answer calls
- **Hourly Distribution**: Call volume by hour
- **Operator Rankings**: Performance comparison
- **Outcome Analysis**: Detailed call results

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions
- `500`: Server error

---

### 3. Get Operator Performance
**GET** `/operator-performance`

Retrieves detailed performance metrics for all operators in the system.

**Required Role:** `admin`

**Query Parameters:**
- `days` (optional): Number of days to analyze (default: 30)

**Example:** `/api/analytics/operator-performance?days=30`

**Response (200):**
```json
{
  "period": {
    "days": 30,
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-30T23:59:59.000Z"
  },
  "systemAverages": {
    "averageConfirmationRate": 82.5,
    "averageCallDuration": 185,
    "averageCallsPerDay": 28.5,
    "totalOperators": 12
  },
  "operatorMetrics": [
    {
      "operatorId": "op_001",
      "operatorName": "John Smith",
      "email": "john@example.com",
      "performance": {
        "totalCalls": 420,
        "confirmedOrders": 375,
        "rejectedOrders": 32,
        "noAnswerCalls": 13,
        "confirmationRate": 89.3,
        "averageCallDuration": 165,
        "callsPerDay": 14.0,
        "responseTime": 8.5
      },
      "trends": {
        "weeklyGrowth": 5.2,
        "monthlyGrowth": 12.8,
        "performanceRank": 1,
        "efficiency": "excellent"
      },
      "timeDistribution": {
        "morningCalls": 180,
        "afternoonCalls": 150,
        "eveningCalls": 90
      }
    }
  ],
  "performanceRankings": [
    {
      "rank": 1,
      "operatorId": "op_001",
      "operatorName": "John Smith",
      "confirmationRate": 89.3,
      "totalCalls": 420
    }
  ],
  "teamMetrics": {
    "topPerformer": {
      "operatorId": "op_001",
      "confirmationRate": 89.3
    },
    "mostImproved": {
      "operatorId": "op_005",
      "improvementRate": 15.2
    },
    "totalTeamCalls": 5040,
    "teamConfirmationRate": 82.5
  }
}
```

**Performance Categories:**
- **excellent**: >90% confirmation rate
- **good**: 80-90% confirmation rate
- **average**: 70-80% confirmation rate
- **needs_improvement**: <70% confirmation rate

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions
- `500`: Server error

---

### 4. Get Revenue Analytics
**GET** `/revenue`

Retrieves comprehensive revenue analytics and financial metrics.

**Required Role:** `admin`

**Response (200):**
```json
{
  "overview": {
    "totalRevenue": 245750.00,
    "monthlyRevenue": 18500.00,
    "yearlyRevenue": 245750.00,
    "averageOrderValue": 125.50,
    "revenueGrowth": 15.2
  },
  "subscriptionRevenue": {
    "totalSubscriptionRevenue": 45600.00,
    "monthlyRecurringRevenue": 3800.00,
    "averageRevenuePerUser": 95.83,
    "churnRate": 2.5,
    "subscriptionGrowth": 8.7
  },
  "revenueByPlan": [
    {
      "plan": "free",
      "subscribers": 25,
      "revenue": 0.00,
      "percentage": 0.0
    },
    {
      "plan": "premium",
      "subscribers": 35,
      "revenue": 1715.00,
      "percentage": 37.6
    },
    {
      "plan": "enterprise",
      "subscribers": 15,
      "revenue": 2985.00,
      "percentage": 65.5
    }
  ],
  "monthlyTrends": [
    {
      "month": "2024-01",
      "revenue": 18500.00,
      "orders": 148,
      "averageOrderValue": 125.00,
      "growth": 12.5
    }
  ],
  "topShops": [
    {
      "shopId": "shop_001",
      "shopName": "Premium Store",
      "revenue": 15750.00,
      "orders": 126,
      "averageOrderValue": 125.00
    }
  ],
  "paymentMetrics": {
    "successfulPayments": 1245,
    "failedPayments": 23,
    "paymentSuccessRate": 98.2,
    "averagePaymentTime": 2.5,
    "refunds": 12,
    "refundRate": 0.96
  }
}
```

**Revenue Metrics:**
- **Total Revenue**: All-time revenue
- **Monthly Recurring Revenue (MRR)**: Subscription revenue
- **Average Revenue Per User (ARPU)**: Revenue per subscriber
- **Churn Rate**: Subscription cancellation rate
- **Growth Rate**: Revenue growth percentage

**Error Responses:**
- `401`: Unauthorized
- `403`: Insufficient permissions
- `500`: Server error

## Data Aggregation

### Time Periods
- **Daily**: Last 30 days of daily data
- **Weekly**: Last 12 weeks of weekly data
- **Monthly**: Last 12 months of monthly data
- **Yearly**: Multi-year trends

### Metrics Calculation
- **Real-time Updates**: Metrics updated in real-time
- **Cached Results**: Frequently accessed data cached
- **Batch Processing**: Heavy calculations processed in background
- **Data Retention**: Historical data preserved for trends

## Performance Optimization

### Caching Strategy
- **Redis Caching**: Frequently accessed metrics cached
- **Cache Invalidation**: Smart cache updates on data changes
- **Query Optimization**: Efficient database queries
- **Aggregation Pipeline**: MongoDB aggregation for complex metrics

### Data Processing
- **Background Jobs**: Heavy calculations processed asynchronously
- **Incremental Updates**: Only process new/changed data
- **Parallel Processing**: Multiple metrics calculated simultaneously
- **Memory Management**: Efficient memory usage for large datasets

## Integration Points

- **Order Service**: Order data for analytics
- **User Service**: User activity and performance data
- **Subscription Service**: Revenue and billing data
- **Queue Service**: Call and processing metrics
- **Notification Service**: Alert thresholds and notifications