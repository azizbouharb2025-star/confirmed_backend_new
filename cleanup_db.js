/***
 * MongoDB Cleanup Script for Confirmed Platform
 * 
 * This script drops all collections to start fresh
 * 
 * Run with:
 *   mongosh confirmed < cleanup_db.js
 * 
 * Or with authentication:
 *   mongosh "mongodb://username:password@localhost:27017/confirmed" < cleanup_db.js
 */

print("🧹 Starting database cleanup...");
print("");

// List of all collections to drop
const collections = [
  'users',
  'shops',
  'products',
  'orders',
  'complaints',
  'subscriptions',
  'couriers',
  'deliveryintegrations',
  'supportcardtokens',
  'activitylogs',
  'rewardtransactions',
  'operatorwallets',
  'missions'
];

collections.forEach(function(collectionName) {
  try {
    db[collectionName].drop();
    print("   ✓ Dropped collection: " + collectionName);
  } catch (e) {
    print("   ⚠ Collection not found: " + collectionName);
  }
});

print("");
print("============================================");
print("✅ Database cleanup completed!");
print("============================================");
print("");
print("You can now run the seed script:");
print("   mongosh confirmed < seed_demo_data.js");
print("");
