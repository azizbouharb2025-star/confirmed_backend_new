/**
 * MongoDB Seed Script for Confirmed Platform
 * 
 * This script uses Mongoose to properly hash passwords and create relationships
 * 
 * Run with:
 *   node seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// Import models
const User = require('./src/models/User');
const Shop = require('./src/models/Shop');
const Product = require('./src/models/Product');
const Order = require('./src/models/Order');
const Complaint = require('./src/models/Complaint');
const Subscription = require('./src/models/Subscription');
const Courier = require('./src/models/Courier');
const ActivityLog = require('./src/models/ActivityLog');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/confirmed';

async function clearDatabase() {
  console.log('🧹 Clearing existing data...');
  
  await User.deleteMany({});
  await Shop.deleteMany({});
  await Product.deleteMany({});
  await Order.deleteMany({});
  await Complaint.deleteMany({});
  await Subscription.deleteMany({});
  await Courier.deleteMany({});
  
  console.log('   ✓ Database cleared');
}

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seed...\n');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');
    
    // Clear existing data
    await clearDatabase();
    
    // ============================================================
    // 1. CREATE SUBSCRIPTIONS
    // ============================================================
    console.log('💳 Creating subscriptions...');
    
    const subscriptionFree = await Subscription.create({
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
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usage: {
        operatorsUsed: 0,
        aiCallsUsed: 0,
        shopsConnected: 0
      }
    });
    
    const subscriptionPro = await Subscription.create({
      plan: 'enterprise',
      features: {
        maxOperators: 999,
        maxAICalls: 999999,
        maxShops: 999,
        prioritySupport: true,
        customIntegrations: true,
        widgets: ['kpi-basic', 'recent-orders', 'performance', 'ai-insights', 'advanced-analytics', 'predictive'],
        advancedAnalytics: true,
        predictiveAnalytics: true
      },
      pricing: {
        amount: 499,
        currency: 'USD',
        interval: 'monthly'
      },
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      usage: {
        operatorsUsed: 2,
        aiCallsUsed: 234,
        shopsConnected: 2
      }
    });
    
    console.log('   ✓ Created 2 subscriptions (Free & Enterprise)\n');
    
    // ============================================================
    // 2. CREATE SHOPS
    // ============================================================
    console.log('🏪 Creating shops...');
    
    const shop1 = await Shop.create({
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
      subscriptionId: subscriptionPro._id,
      isActive: true,
      apiCredentials: {
        apiKey: "sk_live_" + Math.random().toString(36).substring(2, 15),
        apiSecret: "secret_" + Math.random().toString(36).substring(2, 15),
        webhookSecret: "whsec_" + Math.random().toString(36).substring(2, 15),
        isActive: true,
        createdAt: new Date(),
        lastUsed: new Date()
      }
    });
    
    const shop2 = await Shop.create({
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
      subscriptionId: subscriptionPro._id,
      isActive: true
    });
    
    console.log('   ✓ Created 2 shops\n');
    
    // ============================================================
    // 3. CREATE USERS (passwords will be auto-hashed)
    // ============================================================
    console.log('👤 Creating users...');
    
    const admin = await User.create({
      email: "admin@confirmed.tn",
      password: "password123", // Will be hashed by pre-save hook
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
      }
    });
    
    const shopOwner = await User.create({
      email: "owner@techstore.tn",
      password: "password123",
      role: "shop_owner",
      firstName: "Mohamed",
      lastName: "Alami",
      phoneNumber: "+216 98 765 432",
      whatsappNumber: "+216 98 765 432",
      isWhatsappLinked: true,
      country: "Tunisia",
      isActive: true,
      shopId: shop1._id, // Link to the first shop
      subscriptionId: subscriptionPro._id,
      preferences: {
        emailNotifications: true,
        pushNotifications: true
      }
    });
    
    const operator1 = await User.create({
      email: "ahmed.hassan@techstore.tn",
      password: "password123",
      role: "operator",
      firstName: "Ahmed",
      lastName: "Hassan",
      phoneNumber: "+216 97 111 222",
      whatsappNumber: "+216 97 111 222",
      isWhatsappLinked: true,
      country: "Tunisia",
      isActive: true,
      shopId: shop1._id,
      preferences: {
        emailNotifications: true,
        pushNotifications: true
      }
    });
    
    const operator2 = await User.create({
      email: "fatima.zahra@techstore.tn",
      password: "password123",
      role: "operator",
      firstName: "Fatima",
      lastName: "Zahra",
      phoneNumber: "+216 96 333 444",
      whatsappNumber: "+216 96 333 444",
      isWhatsappLinked: true,
      country: "Tunisia",
      isActive: true,
      shopId: shop1._id,
      preferences: {
        emailNotifications: true,
        pushNotifications: true
      }
    });
    
    console.log('   ✓ Created 4 users (passwords hashed)\n');
    
    // ============================================================
    // 4. CREATE COURIERS
    // ============================================================
    console.log('🚚 Creating couriers...');
    
    const courier1 = await Courier.create({
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
      isActive: true
    });
    
    const courier2 = await Courier.create({
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
      isActive: true
    });
    
    const courier3 = await Courier.create({
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
      isActive: true
    });
    
    console.log('   ✓ Created 3 couriers\n');
    
    // ============================================================
    // 5. CREATE PRODUCTS
    // ============================================================
    console.log('📦 Creating products...');
    
    const products = await Product.create([
      {
        shopId: shop1._id,
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
        lastSyncAt: new Date(),
        isActive: true
      },
      {
        shopId: shop1._id,
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
        lastSyncAt: new Date(),
        isActive: true
      },
      {
        shopId: shop1._id,
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
        shopId: shop1._id,
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
        shopId: shop1._id,
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
    ]);
    
    console.log(`   ✓ Created ${products.length} products\n`);
    
    // ============================================================
    // 6. CREATE ORDERS
    // ============================================================
    console.log('📋 Creating orders...');
    
    const tunisianCities = [
      { city: "Tunis", state: "Tunis", courier: courier1._id },
      { city: "Sfax", state: "Sfax", courier: courier2._id },
      { city: "Sousse", state: "Sousse", courier: courier2._id },
      { city: "Ariana", state: "Ariana", courier: courier1._id },
      { city: "Bizerte", state: "Bizerte", courier: courier3._id },
      { city: "Nabeul", state: "Nabeul", courier: courier3._id }
    ];
    
    const customerNames = [
      "Ahmed Ben Ali", "Fatima Mansouri", "Mohamed Trabelsi",
      "Leila Gharbi", "Karim Jebali", "Sonia Hamdi",
      "Youssef Khelifi", "Amira Sassi", "Rami Bouazizi"
    ];
    
    const orders = [];
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    
    for (let i = 0; i < 30; i++) {
      const ordersPerDay = Math.floor(Math.random() * 12) + 8;
      
      for (let j = 0; j < ordersPerDay; j++) {
        const orderDate = new Date(now - i * day);
        const customer = customerNames[Math.floor(Math.random() * customerNames.length)];
        const location = tunisianCities[Math.floor(Math.random() * tunisianCities.length)];
        const product = products[Math.floor(Math.random() * products.length)];
        const quantity = Math.floor(Math.random() * 3) + 1;
        const total = product.price * quantity;
        
        const rand = Math.random();
        let status;
        if (rand < 0.45) status = 'confirmed';
        else if (rand < 0.60) status = 'shipped';
        else if (rand < 0.70) status = 'delivered';
        else if (rand < 0.80) status = 'pending';
        else if (rand < 0.90) status = 'cancelled';
        else status = 'rejected';
        
        let aiScore, riskLevel;
        if (['confirmed', 'shipped', 'delivered'].includes(status)) {
          aiScore = Math.floor(Math.random() * 20) + 75;
          riskLevel = 'low';
        } else if (['cancelled', 'rejected'].includes(status)) {
          aiScore = Math.floor(Math.random() * 30) + 30;
          riskLevel = 'high';
        } else {
          aiScore = Math.floor(Math.random() * 30) + 50;
          riskLevel = aiScore > 70 ? 'low' : aiScore > 50 ? 'medium' : 'high';
        }
        
        const order = {
          orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          shopId: shop1._id,
          clientInfo: {
            name: customer,
            phone: `+216 ${90 + Math.floor(Math.random() * 9)} ${Math.floor(Math.random() * 900 + 100)} ${Math.floor(Math.random() * 900 + 100)}`,
            email: customer.toLowerCase().replace(/ /g, '.') + "@example.com",
            address: {
              street: `${Math.floor(Math.random() * 100 + 1)} Avenue Habib Bourguiba`,
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
        
        if (['confirmed', 'rejected', 'shipped', 'delivered'].includes(status)) {
          order.assignedOperatorId = Math.random() > 0.5 ? operator1._id : operator2._id;
          order.callHistory = [{
            operatorId: order.assignedOperatorId,
            callType: 'human',
            timestamp: new Date(orderDate.getTime() + Math.random() * 2 * 60 * 60 * 1000),
            duration: Math.floor(Math.random() * 300) + 60,
            result: status === 'rejected' ? 'rejected' : 'confirmed',
            notes: status === 'confirmed' ? "Customer confirmed order" : "Customer declined"
          }];
        }
        
        if (status === 'cancelled') {
          const reasons = ['customer_refused', 'price_too_high', 'quality_doubts', 'duplicate_order', 'fake_number', 'not_available'];
          order.cancellationReason = reasons[Math.floor(Math.random() * reasons.length)];
          order.cancelledBy = 'customer';
        }
        
        if (['shipped', 'delivered'].includes(status)) {
          order.deliveryInfo = {
            estimatedDate: new Date(orderDate.getTime() + 3 * day),
            trackingNumber: "TRK" + Math.floor(Math.random() * 1000000),
            carrier: "Aramex"
          };
        }
        
        orders.push(order);
      }
    }
    
    const createdOrders = await Order.insertMany(orders);
    console.log(`   ✓ Created ${createdOrders.length} orders\n`);
    
    // ============================================================
    // 7. CREATE COMPLAINTS
    // ============================================================
    console.log('📝 Creating complaints...');
    
    const deliveredOrders = createdOrders.filter(o => o.status === 'delivered');
    const confirmedOrders = createdOrders.filter(o => o.status === 'confirmed');
    const shippedOrders = createdOrders.filter(o => o.status === 'shipped');
    
    // Create complaints for 20% of delivered orders, 10% of shipped, and 5% of confirmed
    const ordersWithComplaints = [
      ...deliveredOrders.slice(0, Math.floor(deliveredOrders.length * 0.20)),
      ...shippedOrders.slice(0, Math.floor(shippedOrders.length * 0.10)),
      ...confirmedOrders.slice(0, Math.floor(confirmedOrders.length * 0.05))
    ];
    
    const complaintCategories = ['damaged_product', 'wrong_item', 'missing_item', 'quality_issue', 'delivery_problem', 'other'];
    const complaintDescriptions = {
      'damaged_product': [
        "Le produit est arrivé avec un emballage endommagé et l'article présente des rayures",
        "Colis reçu avec des dégâts visibles, le produit ne fonctionne plus",
        "Emballage complètement écrasé, produit cassé à l'intérieur",
        "Article endommagé pendant le transport, écran fissuré"
      ],
      'wrong_item': [
        "J'ai commandé la couleur noire mais j'ai reçu la blanche",
        "Mauvais produit livré, j'ai commandé un casque mais reçu des écouteurs",
        "Taille incorrecte, j'ai commandé du M mais reçu du XL",
        "Modèle différent de celui commandé"
      ],
      'missing_item': [
        "Le colis est arrivé mais il manque les accessoires mentionnés",
        "Câble de chargement manquant dans la boîte",
        "Manuel d'utilisation et garantie absents",
        "Emballage incomplet, plusieurs pièces manquantes"
      ],
      'quality_issue': [
        "La qualité du produit est bien en dessous de mes attentes",
        "Le produit ne correspond pas à la description, matériaux de mauvaise qualité",
        "Article défectueux, ne fonctionne pas correctement",
        "Produit de contrefaçon, pas authentique comme annoncé"
      ],
      'delivery_problem': [
        "Livraison avec 5 jours de retard, aucune communication",
        "Le livreur n'a jamais sonné, j'ai dû aller chercher le colis",
        "Plusieurs tentatives de livraison ratées sans préavis",
        "Colis perdu pendant 2 semaines avant d'arriver"
      ],
      'other': [
        "Besoin d'aide pour l'installation du produit",
        "Question sur la garantie et le service après-vente",
        "Problème de facturation, montant incorrect",
        "Demande de remboursement suite à une erreur"
      ]
    };
    
    const complaints = [];
    for (let i = 0; i < ordersWithComplaints.length; i++) {
      const order = ordersWithComplaints[i];
      const category = complaintCategories[Math.floor(Math.random() * complaintCategories.length)];
      const descriptions = complaintDescriptions[category];
      const description = descriptions[Math.floor(Math.random() * descriptions.length)];
      const daysAfterOrder = Math.floor(Math.random() * 7) + 1;
      
      // Determine status based on age
      let status;
      const statusRand = Math.random();
      if (statusRand < 0.50) status = 'resolved';
      else if (statusRand < 0.70) status = 'closed';
      else if (statusRand < 0.85) status = 'in_progress';
      else if (statusRand < 0.95) status = 'open';
      else status = 'escalated';
      
      const complaint = {
        referenceNumber: `CMP-${Date.now()}-${i}`,
        orderId: order._id,
        shopId: order.shopId,
        customerInfo: {
          name: order.clientInfo.name,
          phone: order.clientInfo.phone,
          email: order.clientInfo.email
        },
        category: category,
        description: description,
        mediaAttachments: [],
        aiTags: [
          { tag: category.replace('_', ' '), confidence: Math.floor(Math.random() * 20) + 75 },
          { tag: status === 'escalated' ? 'urgent' : 'standard', confidence: Math.floor(Math.random() * 15) + 70 }
        ],
        aiPrimaryCategory: category,
        requiresManualReview: Math.random() > 0.6,
        status: status,
        region: order.region,
        productIds: order.items.map(item => item.productId),
        createdAt: new Date(order.createdAt.getTime() + daysAfterOrder * day),
        updatedAt: new Date(order.createdAt.getTime() + (daysAfterOrder + Math.floor(Math.random() * 3)) * day)
      };
      
      // Add resolution history based on status
      if (['resolved', 'closed'].includes(status)) {
        const resolutionDays = Math.floor(Math.random() * 3) + 1;
        complaint.resolvedAt = new Date(complaint.createdAt.getTime() + resolutionDays * day);
        complaint.resolvedBy = Math.random() > 0.5 ? operator1._id : operator2._id;
        complaint.resolutionHistory = [
          {
            status: 'in_progress',
            note: 'Réclamation prise en charge, investigation en cours',
            userId: complaint.resolvedBy,
            timestamp: new Date(complaint.createdAt.getTime() + 2 * hour)
          },
          {
            status: status,
            note: status === 'resolved' 
              ? 'Problème résolu, client satisfait. Remboursement effectué.'
              : 'Dossier clôturé après résolution complète.',
            userId: complaint.resolvedBy,
            timestamp: complaint.resolvedAt
          }
        ];
      } else if (status === 'in_progress') {
        complaint.resolutionHistory = [
          {
            status: 'in_progress',
            note: 'Réclamation en cours de traitement',
            userId: Math.random() > 0.5 ? operator1._id : operator2._id,
            timestamp: new Date(complaint.createdAt.getTime() + 1 * hour)
          }
        ];
      } else if (status === 'escalated') {
        complaint.resolutionHistory = [
          {
            status: 'in_progress',
            note: 'Réclamation prise en charge',
            userId: operator1._id,
            timestamp: new Date(complaint.createdAt.getTime() + 1 * hour)
          },
          {
            status: 'escalated',
            note: 'Escaladé au manager pour traitement prioritaire',
            userId: operator2._id,
            timestamp: new Date(complaint.createdAt.getTime() + 1 * day)
          }
        ];
      }
      
      complaints.push(complaint);
      
      // Update order
      await Order.updateOne({ _id: order._id }, { $set: { hasComplaint: true } });
    }
    
    if (complaints.length > 0) {
      await Complaint.insertMany(complaints);
    }
    console.log(`   ✓ Created ${complaints.length} complaints (${Math.floor(complaints.length * 0.50)} resolved, ${Math.floor(complaints.length * 0.20)} closed, ${Math.floor(complaints.length * 0.15)} in progress)\n`);
    
    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('============================================');
    console.log('🎉 Database seeded successfully!');
    console.log('============================================\n');
    console.log('Collections populated:');
    console.log(`   • subscriptions  — ${await Subscription.countDocuments()} docs (Free & Enterprise)`);
    console.log(`   • users          — ${await User.countDocuments()} docs`);
    console.log(`   • shops          — ${await Shop.countDocuments()} docs`);
    console.log(`   • couriers       — ${await Courier.countDocuments()} docs`);
    console.log(`   • products       — ${await Product.countDocuments()} docs`);
    console.log(`   • orders         — ${await Order.countDocuments()} docs`);
    console.log(`   • complaints     — ${await Complaint.countDocuments()} docs`);
    console.log('\n📋 LOGIN CREDENTIALS:');
    console.log('============================================\n');
    console.log('🔑 Admin Account:');
    console.log('   Email:    admin@confirmed.tn');
    console.log('   Password: password123\n');
    console.log('🏪 Shop Owner Account (ENTERPRISE TIER):');
    console.log('   Email:    owner@techstore.tn');
    console.log('   Password: password123');
    console.log('   Tier:     Enterprise (Full Access)\n');
    console.log('👤 Operator 1:');
    console.log('   Email:    ahmed.hassan@techstore.tn');
    console.log('   Password: password123\n');
    console.log('👤 Operator 2:');
    console.log('   Email:    fatima.zahra@techstore.tn');
    console.log('   Password: password123\n');
    console.log('============================================');
    console.log('✅ All data seeded successfully!');
    console.log('============================================\n');
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('✓ Database connection closed');
  }
}

// Run the seed
seedDatabase();
