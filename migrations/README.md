# Database Migrations

This directory contains database migration scripts for the Confirmed backend.

## Running Migrations

Run migrations in order:

```bash
# 1. Add AI scores to existing orders
node migrations/001-add-ai-scores.js

# 2. Create default couriers
node migrations/002-create-default-couriers.js

# 3. Link complaints to orders
node migrations/003-link-complaints-to-orders.js
```

## Migration Details

### 001-add-ai-scores.js
Adds default AI scoring fields to existing orders:
- `aiScore`: 50 (neutral)
- `riskLevel`: 'medium'
- `deliverySuccessProbability`: 70
- `hasComplaint`: false

### 002-create-default-couriers.js
Creates three default courier companies with regional coverage:
- Courier A: Tunis, Ariana, Ben Arous
- Courier B: Sfax, Sousse, Monastir
- Courier C: Bizerte, Nabeul, Zaghouan

### 003-link-complaints-to-orders.js
Updates orders that have associated complaints by setting the `hasComplaint` flag to true.

## Environment Variables

Ensure your `.env` file contains:
```
MONGODB_URI=mongodb://localhost:27017/confirmed
```

## Notes

- Migrations are idempotent where possible
- Always backup your database before running migrations
- Run migrations in a staging environment first
