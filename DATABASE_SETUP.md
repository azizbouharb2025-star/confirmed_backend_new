# Database Setup Guide

## Quick Start (Recommended Method)

### Using Node.js Script (Properly Hashes Passwords)

This is the recommended method as it uses Mongoose and properly hashes passwords:

```bash
# Simply run the seed script
node seed.js
```

This script will:
- Connect to your MongoDB using the connection string from `.env`
- Clear all existing data
- Create all demo data with properly hashed passwords
- Show a summary of what was created

## Alternative Method (MongoDB Shell)

### 1. Clean Up the Wrong Database

If you accidentally seeded the wrong database (`confirmed_db` instead of `confirmed`), clean it up:

```bash
# Connect to the wrong database and drop it
mongosh confirmed_db --eval "db.dropDatabase()"
```

### 2. Clean Your Correct Database

Before seeding, clean your `confirmed` database:

```bash
# Run the cleanup script
mongosh confirmed < cleanup_db.js
```

### 3. Seed Demo Data

Run the seed script to populate your database:

```bash
# Seed the database
mongosh confirmed < seed_demo_data.js
```

**Note:** The MongoDB shell method uses pre-hashed passwords that may not work with your bcrypt configuration. Use the Node.js method instead.

## With Authentication

If your MongoDB requires authentication, update your `.env` file:

```env
MONGODB_URI=mongodb://username:password@localhost:27017/confirmed
```

Then run:
```bash
node seed.js
```

## What Gets Created

### Subscriptions (2)
- Free plan (0 USD/month)
- Pro plan (99 USD/month)

### Users (4)
- 1 Admin
- 1 Shop Owner
- 2 Operators

### Shops (2)
- TechStore Tunisia (Shopify)
- ElectroShop (WooCommerce)

### Couriers (3)
- Aramex Tunisia
- Poste Tunisienne
- Express Delivery

### Products (5)
- Various electronics and accessories
- Mix of auto-synced and manual products

### Orders (~300-600)
- 30 days of order history
- Various statuses: pending, confirmed, shipped, delivered, cancelled, rejected
- AI scores and risk levels
- Assigned operators
- Call history

### Complaints (~15-20)
- Linked to delivered orders
- Various categories
- AI tags and analysis
- Resolution history

## Login Credentials

All passwords are: `password123`

### Admin
- Email: `admin@confirmed.tn`
- Role: Admin

### Shop Owner
- Email: `owner@techstore.tn`
- Role: Shop Owner
- Shop: TechStore Tunisia

### Operators
- Email: `ahmed.hassan@techstore.tn`
- Email: `fatima.zahra@techstore.tn`
- Role: Operator

## Verify the Seed

After seeding, verify the data:

```bash
mongosh confirmed --eval "
  print('Users:', db.users.countDocuments());
  print('Shops:', db.shops.countDocuments());
  print('Orders:', db.orders.countDocuments());
  print('Products:', db.products.countDocuments());
  print('Complaints:', db.complaints.countDocuments());
  print('Subscriptions:', db.subscriptions.countDocuments());
  print('Couriers:', db.couriers.countDocuments());
"
```

## Troubleshooting

### Wrong Database Name
If you seeded the wrong database, just drop it:
```bash
mongosh wrong_db_name --eval "db.dropDatabase()"
```

### Duplicate Key Errors
Run the cleanup script first to remove all existing data:
```bash
mongosh confirmed < cleanup_db.js
```

### Connection Issues
Make sure MongoDB is running:
```bash
# Check if MongoDB is running
mongosh --eval "db.version()"
```

## Notes

- The seed script uses bcrypt-hashed passwords (production-safe)
- All IDs are generated dynamically (no hardcoded IDs)
- Orders have realistic AI scores based on their status
- Complaints are automatically linked to orders
- All indexes are created automatically
