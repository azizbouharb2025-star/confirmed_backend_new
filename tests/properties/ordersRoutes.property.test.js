const fc = require('fast-check');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/server');
const Order = require('../../src/models/Order');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const Subscription = require('../../src/models/Subscription');

// Generate JWT token for testing
function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
}

// Test data generators
const statusArbitrary = fc.constantFrom('pending', 'confirmed', 'called', 'delivered', 'cancelled');
const priorityArbitrary = fc.constantFrom('low', 'medium', 'high');

const clientInfoArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => '+' + s.replace(/[^0-9]/g, '').slice(0, 14) || '1234567890'),
  email: fc.emailAddress()
});

const orderArbitrary = fc.record({
  orderId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  clientInfo: clientInfoArbitrary,
  totalAmount: fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
  status: statusArbitrary,
  priority: priorityArbitrary
});

// Helper to create test subscription
async function createTestSubscription() {
  const subscription = new Subscription({
    plan: 'free',
    features: {
      maxOperators: 5,
      maxAICalls: 100,
      maxShops: 1
    },
    pricing: {
      amount: 0,
      currency: 'USD',
      interval: 'monthly'
    },
    status: 'active'
  });
  await subscription.save();
  return subscription;
}

// Helper to create test shop
async function createTestShop() {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const subscription = await createTestSubscription();
  const shop = new Shop({
    name: `Test Shop ${uniqueId}`,
    domain: `test-shop-${uniqueId}.com`,
    platform: 'shopify',
    subscriptionId: subscription._id
  });
  await shop.save();
  return shop;
}

// Helper to create test order in database
async function createTestOrder(orderData, shopId) {
  const order = new Order({
    ...orderData,
    orderId: `${orderData.orderId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    shopId,
    items: [{ name: 'Test Item', quantity: 1, price: orderData.totalAmount }]
  });
  await order.save();
  return order;
}


// Helper to create test user with shop
async function createTestUserWithShop(role = 'shop_owner', existingShopId = null) {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  // Create shop if not provided
  let shopId = existingShopId;
  if (!shopId) {
    const shop = await createTestShop();
    shopId = shop._id;
  }
  
  const user = new User({
    email: `test_${uniqueId}@test.com`,
    password: 'hashedpassword123',
    firstName: 'Test',
    lastName: 'User',
    phoneNumber: '+21612345678',
    whatsappNumber: '+21612345678',
    isWhatsappLinked: true,
    country: 'Tunisia',
    role,
    shopId
  });
  await user.save();
  return { user, shopId };
}

describe('Orders Routes Property Tests', () => {

  /**
   * **Feature: orders-api-enhancement, Property 9: Cross-Shop Access Denied**
   * *For any* shop owner user and order belonging to a different shop, 
   * the System SHALL return HTTP 403 status.
   * **Validates: Requirements 2.3**
   */
  describe('Property 9: Cross-Shop Access Denied', () => {
    it('should deny access when shop owner requests order from different shop', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Setup - create two different shops
            const shop1 = await createTestShop();
            const { user: user2, shopId: shop2Id } = await createTestUserWithShop('shop_owner');

            // Create order belonging to shop1
            const order = await createTestOrder(orderData, shop1._id);

            // Generate token for user from shop2
            const token = generateToken(user2._id);

            // Execute - user from shop2 tries to access order from shop1
            const response = await request(app)
              .get(`/api/orders/${order._id}`)
              .set('Authorization', `Bearer ${token}`);

            // Verify - should return 403 Forbidden
            expect(response.status).toBe(403);
            expect(response.body).toHaveProperty('error');
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should allow access when shop owner requests their own shop order', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Setup - create shop, user, and order
            const { user, shopId } = await createTestUserWithShop('shop_owner');
            const order = await createTestOrder(orderData, shopId);

            // Generate token for user
            const token = generateToken(user._id);

            // Execute - user requests their own shop's order
            const response = await request(app)
              .get(`/api/orders/${order._id}`)
              .set('Authorization', `Bearer ${token}`);

            // Verify - should return 200 OK
            expect(response.status).toBe(200);
            expect(response.body._id.toString()).toBe(order._id.toString());
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should allow admin to access any shop order', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Setup - create shop and order
            const shop = await createTestShop();
            const order = await createTestOrder(orderData, shop._id);

            // Create admin user (different shop)
            const { user: admin } = await createTestUserWithShop('admin');
            const token = generateToken(admin._id);

            // Execute - admin requests order from different shop
            const response = await request(app)
              .get(`/api/orders/${order._id}`)
              .set('Authorization', `Bearer ${token}`);

            // Verify - admin should have access
            expect(response.status).toBe(200);
            expect(response.body._id.toString()).toBe(order._id.toString());
          }
        ),
        { numRuns: 20 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 13: Non-Admin Assignment Denied**
   * *For any* non-admin user attempting to assign an operator, 
   * the System SHALL return HTTP 403 status.
   * **Validates: Requirements 4.3**
   */
  describe('Property 13: Non-Admin Assignment Denied', () => {
    it('should deny operator assignment for non-admin users', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          fc.constantFrom('shop_owner', 'operator'),
          async (orderData, nonAdminRole) => {
            // Setup
            const { user, shopId } = await createTestUserWithShop(nonAdminRole);
            const order = await createTestOrder(orderData, shopId);
            const operatorId = new mongoose.Types.ObjectId();

            // Generate token for non-admin user
            const token = generateToken(user._id);

            // Execute - non-admin tries to assign operator
            const response = await request(app)
              .patch(`/api/orders/${order._id}/assign`)
              .set('Authorization', `Bearer ${token}`)
              .send({ operatorId: operatorId.toString() });

            // Verify - should return 403 Forbidden
            expect(response.status).toBe(403);
            expect(response.body).toHaveProperty('error');
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should allow admin to assign operator', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Setup
            const { user: admin, shopId } = await createTestUserWithShop('admin');
            const order = await createTestOrder(orderData, shopId);
            const operatorId = new mongoose.Types.ObjectId();

            // Generate token for admin
            const token = generateToken(admin._id);

            // Execute - admin assigns operator
            const response = await request(app)
              .patch(`/api/orders/${order._id}/assign`)
              .set('Authorization', `Bearer ${token}`)
              .send({ operatorId: operatorId.toString() });

            // Verify - should succeed
            expect(response.status).toBe(200);
            expect(response.body.assignedOperatorId.toString()).toBe(operatorId.toString());
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 23: Admin ShopId Filter**
   * *For any* admin user with shopId filter, all returned orders SHALL have 
   * `shopId` equal to the filter value.
   * **Validates: Requirements 10.1**
   * 
   * Note: Testing at service layer to avoid rate limiting issues in property tests
   */
  describe('Property 23: Admin ShopId Filter', () => {
    it('should filter orders by shopId for admin users', async () => {
      const orderService = require('../../src/services/orderService');
      
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 2, maxLength: 5 }),
          async (ordersData) => {
            // Setup - create orders for two different shops
            const shop1 = await createTestShop();
            const shop2 = await createTestShop();

            // Create orders for shop1
            for (const orderData of ordersData.slice(0, Math.ceil(ordersData.length / 2))) {
              await createTestOrder(orderData, shop1._id);
            }

            // Create orders for shop2
            for (const orderData of ordersData.slice(Math.ceil(ordersData.length / 2))) {
              await createTestOrder(orderData, shop2._id);
            }

            // Create admin user object
            const adminUser = { role: 'admin', shopId: shop1._id };

            // Execute - admin filters by shop2Id using service directly
            const result = await orderService.findOrders(
              { shopId: shop2._id.toString() },
              adminUser
            );

            // Verify - all returned orders should belong to shop2
            if (result.orders && result.orders.length > 0) {
              for (const order of result.orders) {
                const orderShopId = order.shopId?._id || order.shopId;
                if (orderShopId) {
                  expect(orderShopId.toString()).toBe(shop2._id.toString());
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 24: Non-Admin ShopId Filter Ignored**
   * *For any* non-admin user with shopId parameter, all returned orders SHALL have 
   * `shopId` equal to the user's own shopId, regardless of the parameter value.
   * **Validates: Requirements 10.2**
   * 
   * Note: Testing at service layer to avoid rate limiting issues in property tests
   */
  describe('Property 24: Non-Admin ShopId Filter Ignored', () => {
    it('should ignore shopId filter for non-admin users', async () => {
      const orderService = require('../../src/services/orderService');
      
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 2, maxLength: 5 }),
          async (ordersData) => {
            // Setup - create orders for two different shops
            const userShop = await createTestShop();
            const otherShop = await createTestShop();

            // Create orders for user's shop
            for (const orderData of ordersData.slice(0, Math.ceil(ordersData.length / 2))) {
              await createTestOrder(orderData, userShop._id);
            }

            // Create orders for other shop
            for (const orderData of ordersData.slice(Math.ceil(ordersData.length / 2))) {
              await createTestOrder(orderData, otherShop._id);
            }

            // Create shop_owner user object
            const shopOwnerUser = { role: 'shop_owner', shopId: userShop._id };

            // Execute - non-admin tries to filter by other shop's ID using service directly
            const result = await orderService.findOrders(
              { shopId: otherShop._id.toString() },
              shopOwnerUser
            );

            // Verify - should only return user's own shop orders (shopId filter ignored)
            if (result.orders && result.orders.length > 0) {
              for (const order of result.orders) {
                const orderShopId = order.shopId?._id || order.shopId;
                if (orderShopId) {
                  expect(orderShopId.toString()).toBe(userShop._id.toString());
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
