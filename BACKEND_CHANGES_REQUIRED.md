# Backend Changes Required

## Overview
The frontend has been updated with new dashboard features that require corresponding backend API changes. This document outlines all necessary backend modifications.

---

## 1. Dashboard Metrics API Updates

### Endpoint: `GET /api/analytics/dashboard`

**Current Response:**
```json
{
  "ordersReceived": 0,
  "ordersConfirmed": 0,
  "ordersPending": 0,
  "ordersRejected": 0,
  "confirmationRate": 0,
  "revenue": 0,
  "revenueChange": 0,
  "averageOrderValue": 0
}
```

**Required New Fields:**
```json
{
  "ordersReceived": 0,
  "ordersConfirmed": 0,
  "ordersPending": 0,
  "ordersRejected": 0,
  "ordersShipped": 0,                    // NEW - Total shipped orders
  "confirmationRate": 0,
  "deliverySuccessRate": 0,              // NEW - % of orders successfully delivered (last 7 days)
  "complaintRate": 0,                    // NEW - % of orders with complaints
  "avgResolutionTime": 0,                // NEW - Average complaint resolution time in hours
  "revenue": 0,
  "revenueChange": 0,
  "averageOrderValue": 0
}
```

### Implementation Details:

#### `ordersShipped`
- Count of orders with status = 'shipped' or 'delivered'
- Filter by current user's shop(s)
- For Pro plan: Count only today's shipped orders
- For Business/Enterprise: Count all shipped orders

#### `deliverySuccessRate`
- Calculate: (Successfully delivered orders / Total shipped orders) * 100
- Time range: Last 7 days
- Formula: `COUNT(orders WHERE status='delivered' AND deliveredAt >= NOW() - 7 days) / COUNT(orders WHERE status IN ('shipped', 'delivered', 'failed') AND shippedAt >= NOW() - 7 days) * 100`

#### `complaintRate`
- Calculate: (Orders with complaints / Total orders) * 100
- Formula: `COUNT(DISTINCT orders WHERE complaints.length > 0) / COUNT(orders) * 100`
- Only for Business and Enterprise plans

#### `avgResolutionTime`
- Calculate average time between complaint creation and resolution
- Formula: `AVG(complaints.resolvedAt - complaints.createdAt) in hours`
- Only include resolved complaints
- Only for Enterprise plan

---

## 2. Order Model Updates

### Add New Fields to Order Schema:

```javascript
{
  // Existing fields...
  
  // NEW FIELDS:
  aiScore: {
    type: Number,
    min: 0,
    max: 100,
    description: "AI confidence score for order validity (0-100%)"
  },
  
  riskLevel: {
    type: String,
    enum: ['high', 'medium', 'low'],
    description: "Risk level based on AI score: high (>80%), medium (50-80%), low (<50%)"
  },
  
  deliverySuccessProbability: {
    type: Number,
    min: 0,
    max: 100,
    description: "Probability of successful delivery based on courier/region performance"
  },
  
  cancellationReason: {
    type: String,
    enum: [
      'customer_refused',
      'price_too_high',
      'quality_doubts',
      'duplicate_order',
      'fake_number',
      'not_available',
      'courier_failed',
      'customer_rejected_at_door'
    ],
    description: "Reason for order cancellation"
  },
  
  cancellationReasonDetails: {
    type: String,
    description: "Additional details about cancellation"
  },
  
  cancelledBy: {
    type: String,
    enum: ['customer', 'operator', 'system', 'courier'],
    description: "Who cancelled the order"
  },
  
  deliveryAttempts: [{
    attemptNumber: Number,
    attemptDate: Date,
    status: {
      type: String,
      enum: ['failed', 'customer_not_home', 'refused', 'successful']
    },
    notes: String
  }],
  
  courier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Courier',
    description: "Assigned courier/delivery company"
  },
  
  region: {
    type: String,
    description: "Delivery region (e.g., Tunis, Sfax, etc.)"
  },
  
  hasComplaint: {
    type: Boolean,
    default: false,
    description: "Flag indicating if order has associated complaints"
  },
  
  operatorFeedback: {
    confidence: {
      type: String,
      enum: ['strong', 'doubtful', 'neutral']
    },
    notes: String,
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }
}
```

### Update Order Status Enum:
```javascript
status: {
  type: String,
  enum: [
    'pending',
    'assigned',
    'in_progress',
    'confirmed',
    'rejected',
    'cancelled',        // NEW
    'shipped',
    'delivered',
    'failed_delivery'   // NEW
  ]
}
```

---

## 3. New Courier Model

Create a new `Courier` model:

```javascript
const CourierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  
  contactEmail: String,
  contactPhone: String,
  
  regions: [{
    type: String,
    description: "Regions this courier serves"
  }],
  
  performance: {
    totalDeliveries: {
      type: Number,
      default: 0
    },
    successfulDeliveries: {
      type: Number,
      default: 0
    },
    failedDeliveries: {
      type: Number,
      default: 0
    },
    avgDeliveryTime: {
      type: Number,
      description: "Average delivery time in hours"
    },
    returnRate: {
      type: Number,
      description: "Percentage of returned orders"
    }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Virtual for success rate
CourierSchema.virtual('successRate').get(function() {
  if (this.performance.totalDeliveries === 0) return 0;
  return (this.performance.successfulDeliveries / this.performance.totalDeliveries) * 100;
});
```

---

## 4. Risk Score Analytics API

### Endpoint: `GET /api/analytics/risk-score-distribution`

**Response:**
```json
{
  "high": 45,      // Orders with AI score > 80%
  "medium": 30,    // Orders with AI score 50-80%
  "low": 15        // Orders with AI score < 50%
}
```

**Implementation:**
```javascript
// Pseudo-code
const orders = await Order.find({ shopId: user.shopId, status: 'pending' });

const distribution = {
  high: orders.filter(o => o.aiScore > 80).length,
  medium: orders.filter(o => o.aiScore >= 50 && o.aiScore <= 80).length,
  low: orders.filter(o => o.aiScore < 50).length
};
```

---

## 5. Courier Performance API

### Endpoint: `GET /api/analytics/courier-performance`

**Response:**
```json
{
  "couriers": [
    {
      "name": "Courier A",
      "successRate": 85.5,
      "avgDeliveryTime": 48,
      "totalDeliveries": 1250,
      "returnRate": 5.2
    },
    {
      "name": "Courier B",
      "successRate": 92.3,
      "avgDeliveryTime": 36,
      "totalDeliveries": 980,
      "returnRate": 2.1
    }
  ]
}
```

**Implementation:**
```javascript
// Pseudo-code
const couriers = await Courier.find({ isActive: true });

const courierData = await Promise.all(couriers.map(async (courier) => {
  const orders = await Order.find({ 
    courier: courier._id,
    shopId: user.shopId 
  });
  
  const successful = orders.filter(o => o.status === 'delivered').length;
  const total = orders.length;
  
  return {
    name: courier.name,
    successRate: total > 0 ? (successful / total) * 100 : 0,
    avgDeliveryTime: courier.performance.avgDeliveryTime,
    totalDeliveries: total,
    returnRate: courier.performance.returnRate
  };
}));
```

---

## 6. Complaints Analytics API

### Endpoint: `GET /api/analytics/complaints`

**Response:**
```json
{
  "totalComplaints": 45,
  "resolutionRate": 78.5,
  "trendData": [
    { "date": "2024-01-01", "count": 5 },
    { "date": "2024-01-02", "count": 8 }
  ],
  "categories": [
    { "category": "Product Quality", "count": 15 },
    { "category": "Delivery Issue", "count": 12 },
    { "category": "Wrong Item", "count": 8 }
  ],
  "topProductsWithComplaints": [
    { "productId": "123", "productName": "Product A", "count": 10 },
    { "productId": "456", "productName": "Product B", "count": 7 },
    { "productId": "789", "productName": "Product C", "count": 5 }
  ],
  "complaintsThisWeek": {
    "new": 12,
    "resolved": 8
  }
}
```

---

## 7. Orders API Updates

### Endpoint: `GET /api/orders`

**Add Query Parameters:**
- `?filter=risky` - Filter orders with AI score < 50%
- `?courier=<courierId>` - Filter by courier
- `?region=<region>` - Filter by region
- `?hasComplaint=true` - Filter orders with complaints

**Response - Add New Fields:**
```json
{
  "orders": [
    {
      "_id": "...",
      "orderId": "ORD-001",
      "status": "pending",
      "aiScore": 75,                           // NEW
      "riskLevel": "medium",                   // NEW
      "deliverySuccessProbability": 82,        // NEW
      "cancellationReason": null,              // NEW
      "courier": {                             // NEW
        "_id": "...",
        "name": "Courier A"
      },
      "region": "Tunis",                       // NEW
      "hasComplaint": false,                   // NEW
      "operatorFeedback": {                    // NEW
        "confidence": "strong",
        "notes": "Customer sounded confident"
      }
      // ... existing fields
    }
  ]
}
```

---

## 8. Product Performance API

### New Endpoint: `GET /api/analytics/product-performance`

**Response:**
```json
{
  "products": [
    {
      "productId": "123",
      "productName": "Product A",
      "totalOrders": 150,
      "confirmedOrders": 120,
      "confirmationRate": 80,
      "cancellationReasons": {
        "price_too_high": 15,
        "quality_doubts": 10,
        "customer_refused": 5
      },
      "complaintCount": 12,
      "complaintRate": 8
    }
  ]
}
```

---

## 9. Operator Performance API

### Endpoint: `GET /api/analytics/operator-feedback`

**Current Response:**
```json
{
  "averageRating": 4.5,
  "totalFeedback": 120,
  "topTags": [
    { "tag": "Professional", "count": 45 },
    { "tag": "Clear Communication", "count": 38 }
  ]
}
```

**Add New Fields:**
```json
{
  "averageRating": 4.5,
  "totalFeedback": 120,
  "topTags": [...],
  "confidenceBreakdown": {              // NEW
    "strong": 85,
    "doubtful": 20,
    "neutral": 15
  },
  "strongConfirmationRate": 70.8       // NEW - % of strong confirmations today
}
```

---

## 10. Team/Staff Management APIs

### New Endpoint: `GET /api/team/staff`

Get internal staff members (non-operators):

**Response:**
```json
{
  "staff": [
    {
      "_id": "...",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "finance",
      "permissions": ["view_invoices", "manage_payments"],
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### New Endpoint: `GET /api/team/operators`

Get confirmed operators with performance stats:

**Response:**
```json
{
  "operators": [
    {
      "_id": "...",
      "operatorId": "OP-023",
      "name": "Amal",
      "profilePicture": "https://...",
      "performance": {
        "confirmationRate": 85.5,
        "deliveryRate": 78.2,
        "avgCallDuration": 180,
        "reliabilityScore": 92,
        "totalCalls": 1250,
        "confirmedOrders": 1068
      },
      "voiceDemo": "https://...",
      "sellerRating": 4.8,
      "tips": 45.50,
      "thankYouNotes": 12
    }
  ]
}
```

### New Endpoint: `POST /api/team/operators/:operatorId/tip`

Allow sellers to tip operators:

**Request:**
```json
{
  "amount": 5.00,
  "message": "Great job!"
}
```

---

## 11. Statistics API

### New Endpoint: `GET /api/analytics/statistics`

Comprehensive statistics with filters:

**Query Parameters:**
- `startDate` - Start date for range
- `endDate` - End date for range
- `groupBy` - Group by: day, week, month
- `metrics` - Comma-separated metrics to include

**Response:**
```json
{
  "period": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "orders": {
    "total": 1500,
    "confirmed": 1200,
    "cancelled": 150,
    "shipped": 1100,
    "delivered": 1050
  },
  "revenue": {
    "total": 45000,
    "average": 30
  },
  "complaints": {
    "total": 45,
    "resolved": 35,
    "pending": 10
  },
  "couriers": [...],
  "products": [...],
  "timeline": [
    {
      "date": "2024-01-01",
      "orders": 50,
      "revenue": 1500,
      "complaints": 2
    }
  ]
}
```

---

## 12. AI Insights API (Enterprise)

### New Endpoint: `GET /api/analytics/ai-insights`

**Response:**
```json
{
  "highRiskOrders": [
    {
      "orderId": "ORD-001",
      "aiScore": 25,
      "reason": "Customer hesitated + low-value region",
      "recommendation": "Cancel or review manually",
      "estimatedLoss": 35.50
    }
  ],
  "recommendations": [
    {
      "type": "courier_switch",
      "message": "Switch to Courier B in Tunis, success rate 82% vs 45% for Courier A",
      "impact": "high",
      "estimatedImprovement": "+37% success rate"
    },
    {
      "type": "product_adjustment",
      "message": "Product X = 40% cancellations in Sfax → consider price adjustment",
      "impact": "medium",
      "estimatedImprovement": "Reduce cancellations by 15%"
    }
  ],
  "repeatBuyerInsights": {
    "percentageReturningCustomers": 35.5,
    "avgLifetimeValue": 450.00,
    "topReturningCustomers": [...]
  }
}
```

---

## 13. Database Indexes

Add these indexes for performance:

```javascript
// Orders collection
db.orders.createIndex({ "aiScore": 1 });
db.orders.createIndex({ "riskLevel": 1 });
db.orders.createIndex({ "courier": 1 });
db.orders.createIndex({ "region": 1 });
db.orders.createIndex({ "hasComplaint": 1 });
db.orders.createIndex({ "status": 1, "createdAt": -1 });
db.orders.createIndex({ "shopId": 1, "status": 1 });

// Complaints collection
db.complaints.createIndex({ "orderId": 1 });
db.complaints.createIndex({ "status": 1 });
db.complaints.createIndex({ "createdAt": -1 });

// Couriers collection
db.couriers.createIndex({ "isActive": 1 });
db.couriers.createIndex({ "regions": 1 });
```

---

## 14. Middleware Updates

### Subscription Plan Validation

Add middleware to check subscription plan before returning data:

```javascript
function requirePlan(minPlan) {
  return (req, res, next) => {
    const userPlan = req.user.subscriptionPlan;
    const planHierarchy = { starter: 0, pro: 1, business: 2, enterprise: 3 };
    
    if (planHierarchy[userPlan] >= planHierarchy[minPlan]) {
      next();
    } else {
      res.status(403).json({ 
        error: 'Upgrade required',
        requiredPlan: minPlan,
        currentPlan: userPlan
      });
    }
  };
}

// Usage:
app.get('/api/analytics/courier-performance', requirePlan('business'), ...);
app.get('/api/analytics/ai-insights', requirePlan('enterprise'), ...);
```

---

## 15. WebSocket Updates

Update real-time events to include new fields:

```javascript
// When order is updated
socket.emit('order:updated', {
  orderId: order._id,
  status: order.status,
  aiScore: order.aiScore,
  riskLevel: order.riskLevel,
  hasComplaint: order.hasComplaint
});

// When complaint is created
socket.emit('complaint:created', {
  orderId: order._id,
  complaintId: complaint._id
});
```

---

## Priority Implementation Order

### Phase 1 (Critical - Week 1):
1. ✅ Add new fields to Order model
2. ✅ Update dashboard metrics API with new fields
3. ✅ Add cancellation reasons and status
4. ✅ Create Courier model
5. ✅ Implement risk score distribution API

### Phase 2 (High Priority - Week 2):
6. ✅ Implement courier performance API
7. ✅ Update orders API with new filters
8. ✅ Implement complaints analytics API
9. ✅ Add operator feedback enhancements

### Phase 3 (Medium Priority - Week 3):
10. ✅ Implement product performance API
11. ✅ Create team/staff management APIs
12. ✅ Implement statistics API
13. ✅ Add database indexes

### Phase 4 (Enterprise Features - Week 4):
14. ✅ Implement AI insights API
15. ✅ Add subscription plan middleware
16. ✅ Update WebSocket events

---

## Testing Checklist

- [ ] Test all new API endpoints with Postman
- [ ] Verify subscription plan gating works correctly
- [ ] Test performance with large datasets
- [ ] Verify all calculations are accurate (rates, percentages, averages)
- [ ] Test real-time updates via WebSocket
- [ ] Verify database indexes improve query performance
- [ ] Test error handling for all new endpoints
- [ ] Verify data validation for new fields

---

## Migration Scripts Needed

1. **Add AI scores to existing orders:**
```javascript
// migration-add-ai-scores.js
db.orders.updateMany(
  { aiScore: { $exists: false } },
  { 
    $set: { 
      aiScore: 50,  // Default neutral score
      riskLevel: 'medium',
      deliverySuccessProbability: 70
    } 
  }
);
```

2. **Create default couriers:**
```javascript
// migration-create-couriers.js
const defaultCouriers = [
  { name: 'Courier A', regions: ['Tunis', 'Ariana'] },
  { name: 'Courier B', regions: ['Sfax', 'Sousse'] },
  { name: 'Courier C', regions: ['Bizerte', 'Nabeul'] }
];

db.couriers.insertMany(defaultCouriers);
```

3. **Link existing orders to complaints:**
```javascript
// migration-link-complaints.js
const complaints = db.complaints.find({});
complaints.forEach(complaint => {
  db.orders.updateOne(
    { _id: complaint.orderId },
    { $set: { hasComplaint: true } }
  );
});
```

---

## Environment Variables

Add these to `.env`:

```bash
# AI/ML Service (if using external service)
AI_SERVICE_URL=https://ai-service.example.com
AI_SERVICE_API_KEY=your_api_key_here

# Feature Flags
ENABLE_AI_INSIGHTS=true
ENABLE_COURIER_TRACKING=true
ENABLE_OPERATOR_TIPS=true
```

---

## Notes

- All percentage calculations should be rounded to 1 decimal place
- Dates should be in ISO 8601 format
- All monetary values should be in TND (Tunisian Dinar)
- Implement proper error handling and logging for all new endpoints
- Add rate limiting to prevent abuse
- Ensure all sensitive data is properly secured
- Add API documentation (Swagger/OpenAPI)
