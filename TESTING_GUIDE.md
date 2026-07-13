# Testing Guide for Backend Changes

## Quick Start

### 1. Setup
```bash
# Install dependencies (if needed)
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your database credentials
```

### 2. Run Migrations
```bash
# Run in order
node migrations/001-add-ai-scores.js
node migrations/002-create-default-couriers.js
node migrations/003-link-complaints-to-orders.js
```

### 3. Start Server
```bash
# Development
npm run dev

# Production
npm start
```

## API Testing with Postman/cURL

### Dashboard Metrics (Enhanced)
```bash
curl -X GET http://localhost:8000/api/analytics/dashboard \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected new fields:
- `ordersShipped`
- `deliverySuccessRate`
- `complaintRate`
- `avgResolutionTime`

### Product Performance
```bash
curl -X GET http://localhost:8000/api/analytics/product-performance \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### AI Insights (Enterprise Only)
```bash
curl -X GET http://localhost:8000/api/analytics/ai-insights \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Should return 403 if user doesn't have Enterprise plan.

### Courier Performance (Business+)
```bash
curl -X GET http://localhost:8000/api/analytics/courier-performance \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Statistics with Filters
```bash
curl -X GET "http://localhost:8000/api/analytics/statistics?startDate=2024-01-01&endDate=2024-12-31&groupBy=day" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Team Management
```bash
# Get staff
curl -X GET http://localhost:8000/api/team/staff \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get operators
curl -X GET http://localhost:8000/api/team/operators \
  -H "Authorization: Bearer YOUR_TOKEN"

# Tip operator
curl -X POST http://localhost:8000/api/team/operators/OPERATOR_ID/tip \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 5.00, "message": "Great job!"}'
```

### Orders with New Filters
```bash
# Risky orders
curl -X GET "http://localhost:8000/api/orders?filter=risky" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Orders by courier
curl -X GET "http://localhost:8000/api/orders?courier=COURIER_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Orders with complaints
curl -X GET "http://localhost:8000/api/orders?hasComplaint=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## WebSocket Testing

### Connect to WebSocket
```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:8000', {
  auth: {
    token: 'YOUR_JWT_TOKEN'
  }
});

socket.on('connect', () => {
  console.log('Connected to WebSocket');
});

// Listen for order updates
socket.on('order:update', (message) => {
  console.log('Order updated:', message);
  // Check for new fields: aiScore, riskLevel, hasComplaint
});

// Listen for complaint creation
socket.on('complaint:created', (message) => {
  console.log('Complaint created:', message);
});
```

## Database Verification

### Check Migrations
```javascript
// Connect to MongoDB
use confirmed

// Check orders have AI scores
db.orders.findOne({ aiScore: { $exists: true } })

// Check couriers exist
db.couriers.find()

// Check complaints linked to orders
db.orders.findOne({ hasComplaint: true })
```

### Verify Indexes
```javascript
// Check order indexes
db.orders.getIndexes()

// Should include:
// - aiScore_1
// - riskLevel_1
// - courier_1
// - hasComplaint_1
// - status_1_createdAt_-1
```

## Test Scenarios

### Scenario 1: Create Order with AI Score
```bash
curl -X POST http://localhost:8000/api/orders \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "TEST-001",
    "clientInfo": {
      "name": "Test Customer",
      "phone": "+216 12 345 678"
    },
    "items": [{"name": "Product A", "quantity": 1, "price": 50}],
    "totalAmount": 50,
    "aiScore": 75,
    "riskLevel": "medium",
    "deliverySuccessProbability": 80
  }'
```

### Scenario 2: Create Complaint and Check Order Flag
```bash
# 1. Create complaint
curl -X POST http://localhost:8000/api/complaints \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "ORDER_ID",
    "category": "quality_issue",
    "description": "Product arrived damaged",
    "customerInfo": {
      "name": "Test Customer",
      "phone": "+216 12 345 678"
    }
  }'

# 2. Check order has complaint flag
curl -X GET http://localhost:8000/api/orders/ORDER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should have: "hasComplaint": true
```

### Scenario 3: Test Plan Restrictions
```bash
# Try to access Enterprise endpoint with Pro plan
curl -X GET http://localhost:8000/api/analytics/ai-insights \
  -H "Authorization: Bearer PRO_USER_TOKEN"

# Expected: 403 Forbidden
# {
#   "error": "Upgrade required",
#   "requiredPlan": "enterprise",
#   "currentPlan": "pro"
# }
```

### Scenario 4: Assign Courier to Order
```bash
# Get courier ID first
curl -X GET http://localhost:8000/api/analytics/courier-performance \
  -H "Authorization: Bearer YOUR_TOKEN"

# Update order with courier
curl -X PATCH http://localhost:8000/api/orders/ORDER_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "courier": "COURIER_ID",
    "region": "Tunis"
  }'
```

## Performance Testing

### Load Test Dashboard Metrics
```bash
# Using Apache Bench
ab -n 1000 -c 10 -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/analytics/dashboard
```

### Check Query Performance
```javascript
// In MongoDB shell
db.orders.find({ aiScore: { $lt: 50 } }).explain("executionStats")

// Should use aiScore_1 index
// executionTimeMillis should be low
```

## Common Issues

### Issue: Migration fails with "duplicate key error"
**Solution**: Migrations are idempotent. If courier already exists, it will skip creation.

### Issue: 403 Forbidden on analytics endpoints
**Solution**: Check user's subscription plan. Some endpoints require Business or Enterprise plans.

### Issue: WebSocket not receiving events
**Solution**: 
1. Check authentication token is valid
2. Verify user is in correct shop room
3. Check server logs for WebSocket errors

### Issue: Orders not showing new fields
**Solution**: Run migration 001-add-ai-scores.js to add default values to existing orders.

## Monitoring

### Check Server Logs
```bash
# Development
npm run dev

# Production logs
pm2 logs confirmed-backend

# Or check log files
tail -f logs/combined.log
tail -f logs/error.log
```

### Health Check
```bash
curl http://localhost:8000/health
```

## Rollback Plan

If issues occur:

1. **Stop Server**
   ```bash
   pm2 stop confirmed-backend
   ```

2. **Restore Database**
   ```bash
   mongorestore --uri="mongodb://..." backup-YYYYMMDD/
   ```

3. **Revert Code**
   ```bash
   git revert HEAD
   npm install
   ```

4. **Restart Server**
   ```bash
   pm2 start confirmed-backend
   ```

## Success Criteria

✅ All migrations run without errors
✅ Server starts without errors
✅ All new API endpoints return 200 OK
✅ WebSocket events include new fields
✅ Plan restrictions work correctly
✅ Database indexes are created
✅ No performance degradation on existing endpoints
