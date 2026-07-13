/***
 * MongoDB Seed Script for Confirmed Platform - COMPLETE DEMO DATA
 * 
 * This script creates ALL necessary data based on actual models
 * 
 * Run on your VPS with:
 *   mongosh confirmed < seed_demo_data.js
 * 
 * Or with authentication:
 *   mongosh "mongodb://username:password@localhost:27017/confirmed" < seed_demo_data.js
 * 
 * ✅ This script is SELF-CONTAINED - no need to update IDs!
 */

// ============================================================
// GENERATE NEW IDs
// ============================================================
const ADMIN_ID = ObjectId();
const SHOP_OWNER_ID = ObjectId();
const OPERATOR_1_ID = ObjectId();
const OPERATOR_2_ID = ObjectId();

const SUBSCRIPTION_FREE_ID = ObjectId();
const SUBSCRIPTION_PRO_ID = ObjectId();

const SHOP_1_ID = ObjectId();
const SHOP_2_ID = ObjectId();

const COURIER_1_ID = ObjectId();
const COURIER_2_ID = ObjectId();
const COURIER_3_ID = ObjectId();

// ============================================================
const now = new Date();
const hour = 60 * 60 * 1000;
const day = 24 * hour;

print("🌱 Starting complete demo data seed...");
print("");

// ============================================================
// 1. CREATE SUBSCRIPTIONS FIRST
// ============================================================
print("💳 Creating subscriptions...");

db.subscriptions.insertMany([
  {
    _id: SUBSCRIPTION_FREE_ID,
    plan: 'free',
    features: {
      maxOperators: 1,
      maxAICalls: 0,
      maxShops: 1,
      prioritySupport: false,
      customIntegrations: false,
      widgets: ['kpi-basic', 'recent-orders'],
      advancedAnalytics: false,
      predictiveAnalytics: false
    },
    pricing: {
      amount: 0,
      currency: 'USD',
      interval: 'monthly'
    },
    status: 'active',
    currentPeriodStart: new Date(now - 30 * day),
    currentPeriodEnd: new Date(now + 30 * day),
    usage: {
      operatorsUsed: 0,
      aiCallsUsed: 0,
      shopsConnected: 0
    },
    createdAt: new Date(now - 90 * day),
    updatedAt: now
  },
  {
    _id: SUBSCRIPTION_PRO_ID,
    plan: 'pro',
    features: {
      maxOperators: 10,
      maxAICalls: 1000,
      maxShops: 3,
      prioritySupport: true,
      customIntegrations: false,
      widgets: ['kpi-basic', 'recent-orders', 'performance', 'ai-insights'],
      advancedAnalytics: true,
      predictiveAnalytics: true
    },
    pricing: {
      amount: 99,
      currency: 'USD',
      interval: 'monthly'
    },
    status: 'active',
    currentPeriodStart: new Date(now - 15 * day),
    currentPeriodEnd: new Date(now + 15 * day),
    usage: {
      operatorsUsed: 2,
      aiCallsUsed: 234,
      shopsConnected: 2
    },
    createdAt: new Date(now - 60 * day),
    updatedAt: now
  }
]);

print("   ✓ Created 2 subscriptions");

// ============================================================
// 2. CREATE USERS
// ============================================================
print("👤 Creating users...");

db.users.insertMany([
  {
    _id: ADMIN_ID,
    email: "admin@confirmed.tn",
    password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW", // "password123"
    role: "admin",
    firstName: "Admin",
    lastName: "User",
    phoneNumber: "+216 70 123 456",
    whatsappNumber: "+216 70 123 456",
    isWhatsappLinked: true,
    country: "Tunisia",
    isActive: true,
    preferences: {
      emailNotifications: true,
      pushNotifications: true
    },
    createdAt: new Date(now - 90 * day),
    updatedAt: now
  },
  {
    _id: SHOP_OWNER_ID,
    email: "owner@techstore.tn",
    password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW", // "password123"
    role: "shop_owner",
    firstName: "Mohamed",
    lastName: "Alami",
    phoneNumber: "+216 98 765 432",
    whatsappNumber: "+216 98 765 432",
    isWhatsappLinked: true,
    country: "Tunisia",
    isActive: true,
    subscriptionId: SUBSCRIPTION_PRO_ID,
    preferences: {
      emailNotifications: true,
      pushNotifications: true
    },
    createdAt: new Date(now - 60 * day),
    updatedAt: now
  },
  {
    _id: OPERATOR_1_ID,
    email: "ahmed.hassan@techstore.tn",
    password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW", // "password123"
    role: "operator",
    firstName: "Ahmed",
    lastName: "Hassan",
    phoneNumber: "+216 97 111 222",
    whatsappNumber: "+216 97 111 222",
    isWhatsappLinked: true,
    country: "Tunisia",
    isActive: true,
    shopId: SHOP_1_ID,
    preferences: {
      emailNotifications: true,
      pushNotifications: true
    },
    createdAt: new Date(now - 30 * day),
    updatedAt: now
  },
  {
    _id: OPERATOR_2_ID,
    email: "fatima.zahra@techstore.tn",
    password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW", // "password123"
    role: "operator",
    firstName: "Fatima",
    lastName: "Zahra",
    phoneNumber: "+216 96 333 444",
    whatsappNumber: "+216 96 333 444",
    isWhatsappLinked: true,
    country: "Tunisia",
    isActive: true,
    shopId: SHOP_1_ID,
    preferences: {
      emailNotifications: true,
      pushNotifications: true
    },
    createdAt: new Date(now - 20 * day),
    updatedAt: now
  }
]);

print("   ✓ Created 4 users (1 admin, 1 shop owner, 2 operators)");

// ============================================================
// 3. CREATE SHOPS
// ============================================================
print("🏪 Creating shops...");

db.shops.insertMany([
  {
    _id: SHOP_1_ID,
    name: "TechStore Tunisia",
    domain: "techstore.tn",
    platform: "shopify",
    shopifyCredentials: {
      apiKey: "demo_api_key_123",
      apiSecret: "demo_api_secret_456",
      accessToken: "demo_access_token_789",
      storeUrl: "techstore-tn.myshopify.com",
      webhookSecret: "demo_webhook_secret"
    },
    settings: {
      autoSync: true,
      aiCallsEnabled: true,
      callPriority: "high",
      productSyncEnabled: true,
      deliveryIntegrationEnabled: true
    },
    subscriptionId: SUBSCRIPTION_PRO_ID,
    isActive: true,
    apiCredentials: {
      apiKey: "sk_live_" + Math.random().toString(36).substring(2, 15),
      apiSecret: "secret_" + Math.random().toString(36).substring(2, 15),
      webhookSecret: "whsec_" + Math.random().toString(36).substring(2, 15),
      isActive: true,
      createdAt: new Date(now - 60 * day),
      lastUsed: new Date(now - 1 * hour)
    },
    createdAt: new Date(now - 60 * day),
    updatedAt: now
  },
  {
    _id: SHOP_2_ID,
    name: "ElectroShop",
    domain: "electroshop.tn",
    platform: "woocommerce",
    woocommerceCredentials: {
      consumerKey: "ck_demo_key_123",
      consumerSecret: "cs_demo_secret_456",
      storeUrl: "https://electroshop.tn",
      webhookSecret: "demo_webhook_secret"
    },
    settings: {
      autoSync: true,
      aiCallsEnabled: false,
      callPriority: "medium",
      productSyncEnabled: true,
      deliveryIntegrationEnabled: false
    },
    subscriptionId: SUBSCRIPTION_PRO_ID,
    isActive: true,
    createdAt: new Date(now - 45 * day),
    updatedAt: now
  }
]);

print("   ✓ Created 2 shops");

// ============================================================
// 4. CREATE COURIERS
// ============================================================
print("🚚 Creating couriers...");

db.couriers.insertMany([
  {
    _id: COURIER_1_ID,
    name: "Aramex Tunisia",
    contactEmail: "contact@aramex.tn",
    contactPhone: "+216 71 123 456",
    regions: ["Tunis", "Ariana", "Ben Arous", "Manouba"],
    performance: {
      totalDeliveries: 1250,
      successfulDeliveries: 1100,
      failedDeliveries: 150,
      avgDeliveryTime: 48,
      returnRate: 12
    },
    isActive: true,
    createdAt: new Date(now - 180 * day)
  },
  {
    _id: COURIER_2_ID,
    name: "Poste Tunisienne",
    contactEmail: "info@poste.tn",
    contactPhone: "+216 71 234 567",
    regions: ["Sfax", "Sousse", "Monastir", "Mahdia", "Kairouan"],
    performance: {
      totalDeliveries: 890,
      successfulDeliveries: 750,
      failedDeliveries: 140,
      avgDeliveryTime: 72,
      returnRate: 15.7
    },
    isActive: true,
    createdAt: new Date(now - 180 * day)
  },
  {
    _id: COURIER_3_ID,
    name: "Express Delivery",
    contactEmail: "support@express.tn",
    contactPhone: "+216 71 345 678",
    regions: ["Bizerte", "Nabeul", "Zaghouan", "Beja"],
    performance: {
      totalDeliveries: 560,
      successfulDeliveries: 510,
      failedDeliveries: 50,
      avgDeliveryTime: 36,
      returnRate: 8.9
    },
    isActive: true,
    createdAt: new Date(now - 90 * day)
  }
]);

print("   ✓ Created 3 couriers");

// ============================================================
// 5. CREATE PRODUCTS
// ============================================================
print("📦 Creating products...");

const products = [
  {
    shopId: SHOP_1_ID,
    externalId: "shopify_prod_001",
    name: "Wireless Headphones Pro",
    productLink: "https://techstore.tn/products/wireless-headphones-pro",
    price: 299.99,
    sku: "WH-PRO-001",
    description: "Premium noise-cancelling wireless headphones with 30-hour battery life",
    imageUrl: "https://techstore.tn/images/headphones-pro.jpg",
    category: "Electronics",
    inStock: true,
    syncMethod: "auto_sync",
    lastSyncAt: new Date(now - 2 * hour),
    isActive: true
  },
  {
    shopId: SHOP_1_ID,
    externalId: "shopify_prod_002",
    name: "Smart Watch Series 5",
    productLink: "https://techstore.tn/products/smart-watch-5",
    price: 199.99,
    sku: "SW-005",
    description: "Fitness tracking smartwatch with heart rate monitor and GPS",
    imageUrl: "https://techstore.tn/images/smartwatch-5.jpg",
    category: "Wearables",
    inStock: true,
    syncMethod: "auto_sync",
    lastSyncAt: new Date(now - 2 * hour),
    isActive: true
  },
  {
    shopId: SHOP_1_ID,
    name: "Laptop Stand Aluminum",
    productLink: "https://techstore.tn/products/laptop-stand",
    price: 49.99,
    sku: "LS-ALU-003",
    description: "Ergonomic aluminum laptop stand with adjustable height",
    imageUrl: "https://techstore.tn/images/laptop-stand.jpg",
    category: "Accessories",
    inStock: true,
    syncMethod: "manual",
    isActive: true
  },
  {
    shopId: SHOP_1_ID,
    name: "USB-C Fast Charging Cable 2m",
    productLink: "https://techstore.tn/products/usbc-cable",
    price: 19.99,
    sku: "UC-2M-004",
    description: "Durable braided USB-C cable with 100W fast charging support",
    imageUrl: "https://techstore.tn/images/usbc-cable.jpg",
    category: "Accessories",
    inStock: true,
    syncMethod: "manual",
    isActive: true
  },
  {
    shopId: SHOP_1_ID,
    name: "Wireless Keyboard RGB",
    productLink: "https://techstore.tn/products/keyboard-rgb",
    price: 129.99,
    sku: "KB-RGB-007",
    description: "Mechanical wireless keyboard with customizable RGB lighting",
    imageUrl: "https://techstore.tn/images/keyboard-rgb.jpg",
    category: "Peripherals",
    inStock: true,
    syncMethod: "manual",
    isActive: true
  }
];

const insertedProducts = [];
products.forEach(function(product) {
  product._id = ObjectId();
  product.createdAt = new Date(now - Math.floor(Math.random() * 60) * day);
  product.updatedAt = new Date(now - Math.floor(Math.random() * 5) * day);
  insertedProducts.push(product);
});

db.products.insertMany(insertedProducts);
print("   ✓ Created " + insertedProducts.length + " products");

// ============================================================
// 6. CREATE ORDERS
// ============================================================
print("📋 Creating orders...");

const tunisianCities = [
  { city: "Tunis", state: "Tunis", courier: COURIER_1_ID },
  { city: "Sfax", state: "Sfax", courier: COURIER_2_ID },
  { city: "Sousse", state: "Sousse", courier: COURIER_2_ID },
  { city: "Ariana", state: "Ariana", courier: COURIER_1_ID },
  { city: "Bizerte", state: "Bizerte", courier: COURIER_3_ID },
  { city: "Nabeul", state: "Nabeul", courier: COURIER_3_ID }
];

const customerNames = [
  "Ahmed Ben Ali", "Fatima Mansouri", "Mohamed Trabelsi",
  "Leila Gharbi", "Karim Jebali", "Sonia Hamdi",
  "Youssef Khelifi", "Amira Sassi", "Rami Bouazizi"
];

function generateOrder(daysAgo, status) {
  const orderDate = new Date(now - daysAgo * day);
  const orderId = "ORD-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  
  const customer = customerNames[Math.floor(Math.random() * customerNames.length)];
  const location = tunisianCities[Math.floor(Math.random() * tunisianCities.length)];
  const product = insertedProducts[Math.floor(Math.random() * insertedProducts.length)];
  
  const quantity = Math.floor(Math.random() * 3) + 1;
  const total = product.price * quantity;
  
  // AI scores based on status
  let aiScore, riskLevel;
  if (status === 'confirmed' || status === 'shipped' || status === 'delivered') {
    aiScore = Math.floor(Math.random() * 20) + 75; // 75-95
    riskLevel = 'low';
  } else if (status === 'cancelled' || status === 'rejected') {
    aiScore = Math.floor(Math.random() * 30) + 30; // 30-60
    riskLevel = 'high';
  } else {
    aiScore = Math.floor(Math.random() * 30) + 50; // 50-80
    riskLevel = aiScore > 70 ? 'low' : aiScore > 50 ? 'medium' : 'high';
  }
  
  const order = {
    _id: ObjectId(),
    orderId: orderId,
    shopId: SHOP_1_ID,
    clientInfo: {
      name: customer,
      phone: "+216 " + (90 + Math.floor(Math.random() * 9)) + " " + 
             Math.floor(Math.random() * 900 + 100) + " " + 
             Math.floor(Math.random() * 900 + 100),
      email: customer.toLowerCase().replace(/ /g, '.') + "@example.com",
      address: {
        street: Math.floor(Math.random() * 100 + 1) + " Avenue Habib Bourguiba",
        city: location.city,
        state: location.state,
        zipCode: String(Math.floor(Math.random() * 9000) + 1000),
        country: "Tunisia"
      }
    },
    items: [{
      productId: product._id,
      name: product.name,
      quantity: quantity,
      price: product.price,
      sku: product.sku,
      url: product.productLink
    }],
    totalAmount: total,
    status: status,
    priority: total > 200 ? 'high' : total > 100 ? 'medium' : 'low',
    aiScore: aiScore,
    riskLevel: riskLevel,
    deliverySuccessProbability: aiScore,
    courier: location.courier,
    region: location.state,
    hasComplaint: false,
    isRepeatBuyer: Math.random() > 0.7,
    customerLifetimeValue: Math.floor(Math.random() * 1000),
    createdAt: orderDate,
    updatedAt: orderDate
  };
  
  // Add operator assignment for processed orders
  if (['confirmed', 'rejected', 'shipped', 'delivered'].includes(status)) {
    order.assignedOperatorId = Math.random() > 0.5 ? OPERATOR_1_ID : OPERATOR_2_ID;
    order.callHistory = [{
      operatorId: order.assignedOperatorId,
      callType: 'human',
      timestamp: new Date(orderDate.getTime() + Math.random() * 2 * hour),
      duration: Math.floor(Math.random() * 300) + 60,
      result: status === 'confirmed' ? 'confirmed' : status === 'rejected' ? 'rejected' : 'confirmed',
      notes: status === 'confirmed' ? "Customer confirmed order" : "Customer declined"
    }];
  }
  
  // Add cancellation details
  if (status === 'cancelled') {
    const reasons = [
      'customer_refused', 'price_too_high', 'quality_doubts',
      'duplicate_order', 'fake_number', 'not_available'
    ];
    order.cancellationReason = reasons[Math.floor(Math.random() * reasons.length)];
    order.cancelledBy = 'customer';
  }
  
  // Add delivery info for shipped/delivered
  if (status === 'shipped' || status === 'delivered') {
    order.deliveryInfo = {
      estimatedDate: new Date(orderDate.getTime() + 3 * day),
      trackingNumber: "TRK" + Math.floor(Math.random() * 1000000),
      carrier: "Aramex"
    };
  }
  
  return order;
}

// Generate orders for last 30 days
const orders = [];
for (let i = 0; i < 30; i++) {
  const ordersPerDay = Math.floor(Math.random() * 12) + 8; // 8-20 orders per day
  
  for (let j = 0; j < ordersPerDay; j++) {
    const rand = Math.random();
    let status;
    
    if (rand < 0.45) status = 'confirmed';
    else if (rand < 0.60) status = 'shipped';
    else if (rand < 0.70) status = 'delivered';
    else if (rand < 0.80) status = 'pending';
    else if (rand < 0.90) status = 'cancelled';
    else status = 'rejected';
    
    orders.push(generateOrder(i, status));
  }
}

db.orders.insertMany(orders);
print("   ✓ Created " + orders.length + " orders");

// ============================================================
// 7. CREATE COMPLAINTS
// ============================================================
print("📝 Creating complaints...");

const complaints = [];
const complaintCategories = [
  'damaged_product', 'wrong_item', 'missing_item',
  'quality_issue', 'delivery_problem', 'other'
];

const complaintDescriptions = {
  'damaged_product': "Product arrived with visible damage to the packaging and item",
  'wrong_item': "Received incorrect product, ordered black but got white",
  'missing_item': "Package arrived but missing accessories mentioned in description",
  'quality_issue': "Product quality is below expectations, not as described",
  'delivery_problem': "Delivery was significantly delayed, arrived 5 days late",
  'other': "Customer service issue, need assistance with product setup"
};

// Create complaints for some delivered orders
const deliveredOrders = orders.filter(o => o.status === 'delivered');
const ordersWithComplaints = deliveredOrders.slice(0, Math.floor(deliveredOrders.length * 0.15));

ordersWithComplaints.forEach(function(order, index) {
  const category = complaintCategories[Math.floor(Math.random() * complaintCategories.length)];
  const daysAfterDelivery = Math.floor(Math.random() * 5) + 1;
  
  const complaint = {
    _id: ObjectId(),
    referenceNumber: "CMP-" + Date.now() + "-" + index,
    orderId: order._id,
    shopId: order.shopId,
    customerInfo: {
      name: order.clientInfo.name,
      phone: order.clientInfo.phone,
      email: order.clientInfo.email
    },
    category: category,
    description: complaintDescriptions[category],
    mediaAttachments: [],
    aiTags: [
      { tag: category.replace('_', ' '), confidence: 85 },
      { tag: 'requires_attention', confidence: 72 }
    ],
    aiPrimaryCategory: category,
    requiresManualReview: Math.random() > 0.7,
    status: Math.random() > 0.4 ? 'resolved' : 'in_progress',
    region: order.region,
    productIds: order.items.map(item => item.productId),
    createdAt: new Date(order.createdAt.getTime() + daysAfterDelivery * day),
    updatedAt: new Date(order.createdAt.getTime() + (daysAfterDelivery + 2) * day)
  };
  
  if (complaint.status === 'resolved') {
    complaint.resolvedAt = new Date(complaint.createdAt.getTime() + 2 * day);
    complaint.resolvedBy = OPERATOR_1_ID;
    complaint.resolutionHistory = [{
      status: 'resolved',
      note: 'Issue resolved, customer satisfied',
      userId: OPERATOR_1_ID,
      timestamp: complaint.resolvedAt
    }];
  }
  
  complaints.push(complaint);
  
  // Update order to mark it has complaint
  db.orders.updateOne(
    { _id: order._id },
    { $set: { hasComplaint: true } }
  );
});

if (complaints.length > 0) {
  db.complaints.insertMany(complaints);
}
print("   ✓ Created " + complaints.length + " complaints");

// ============================================================
// 8. CREATE INDEXES
// ============================================================
print("🔍 Creating indexes...");

// Users
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ role: 1 });
db.users.createIndex({ shopId: 1 });

// Shops
db.shops.createIndex({ domain: 1 });
db.shops.createIndex({ subscriptionId: 1 });
db.shops.createIndex({ 'apiCredentials.apiKey': 1 });

// Products
db.products.createIndex({ shopId: 1, externalId: 1 });
db.products.createIndex({ syncMethod: 1 });
db.products.createIndex({ shopId: 1, sku: 1 });

// Orders
db.orders.createIndex({ shopId: 1, createdAt: -1 });
db.orders.createIndex({ status: 1, createdAt: -1 });
db.orders.createIndex({ assignedOperatorId: 1, status: 1 });
db.orders.createIndex({ orderId: 1, shopId: 1 }, { unique: true });
db.orders.createIndex({ aiScore: 1 });
db.orders.createIndex({ riskLevel: 1 });
db.orders.createIndex({ courier: 1 });
db.orders.createIndex({ region: 1 });
db.orders.createIndex({ hasComplaint: 1 });

// Complaints
db.complaints.createIndex({ referenceNumber: 1 }, { unique: true });
db.complaints.createIndex({ shopId: 1, status: 1 });
db.complaints.createIndex({ shopId: 1, category: 1 });
db.complaints.createIndex({ shopId: 1, createdAt: -1 });
db.complaints.createIndex({ orderId: 1 });

// Subscriptions
db.subscriptions.createIndex({ plan: 1 });
db.subscriptions.createIndex({ status: 1 });

// Couriers
db.couriers.createIndex({ isActive: 1 });
db.couriers.createIndex({ regions: 1 });

print("   ✓ All indexes created");

// ============================================================
// 9. SUMMARY
// ============================================================
print("");
print("============================================");
print("🎉 Complete demo data seed finished!");
print("============================================");
print("");
print("Collections populated:");
print("   • subscriptions  — " + db.subscriptions.countDocuments() + " docs");
print("   • users          — " + db.users.countDocuments() + " docs");
print("   • shops          — " + db.shops.countDocuments() + " docs");
print("   • couriers       — " + db.couriers.countDocuments() + " docs");
print("   • products       — " + db.products.countDocuments() + " docs");
print("   • orders         — " + db.orders.countDocuments() + " docs");
print("   • complaints     — " + db.complaints.countDocuments() + " docs");
print("");
print("📋 LOGIN CREDENTIALS:");
print("============================================");
print("");
print("🔑 Admin Account:");
print("   Email:    admin@confirmed.tn");
print("   Password: password123");
print("");
print("🏪 Shop Owner Account:");
print("   Email:    owner@techstore.tn");
print("   Password: password123");
print("   Shop:     TechStore Tunisia");
print("");
print("👤 Operator 1:");
print("   Email:    ahmed.hassan@techstore.tn");
print("   Password: password123");
print("");
print("👤 Operator 2:");
print("   Email:    fatima.zahra@techstore.tn");
print("   Password: password123");
print("");
print("============================================");
print("✅ All data seeded successfully!");
print("============================================");
