const request = require('supertest');
const app = require('../src/server');
const User = require('../src/models/User');
const Shop = require('../src/models/Shop');
const Order = require('../src/models/Order');
const jwt = require('jsonwebtoken');

describe('Order Endpoints', () => {
  let token, shopId, userId;

  beforeEach(async () => {
    const user = new User({
      email: 'shop@example.com',
      password: 'password123',
      firstName: 'Shop',
      lastName: 'Owner',
      phoneNumber: '+21612345678',
      whatsappNumber: '+21612345678',
      isWhatsappLinked: true,
      country: 'Tunisia',
      role: 'shop_owner'
    });
    await user.save();
    userId = user._id;

    const shop = new Shop({
      name: 'Test Shop',
      domain: 'test-shop.com',
      platform: 'shopify',
      subscriptionId: user._id // Mock subscription
    });
    await shop.save();
    shopId = shop._id;

    user.shopId = shopId;
    await user.save();

    token = jwt.sign({ id: userId }, process.env.JWT_SECRET);
  });

  describe('POST /api/orders', () => {
    it('should create a new order', async () => {
      const orderData = {
        orderId: 'ORDER123',
        clientInfo: {
          name: 'John Doe',
          phone: '+1234567890',
          email: 'john@example.com'
        },
        items: [{
          name: 'Product 1',
          quantity: 2,
          price: 29.99
        }],
        totalAmount: 59.98
      };

      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send(orderData)
        .expect(201);

      expect(response.body.orderId).toBe(orderData.orderId);
      expect(response.body.shopId).toBe(shopId.toString());
    });
  });

  describe('GET /api/orders', () => {
    beforeEach(async () => {
      const order = new Order({
        orderId: 'ORDER123',
        shopId,
        clientInfo: {
          name: 'John Doe',
          phone: '+1234567890'
        },
        totalAmount: 59.98
      });
      await order.save();
    });

    it('should get orders for shop owner', async () => {
      const response = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.orders).toHaveLength(1);
      expect(response.body.orders[0].orderId).toBe('ORDER123');
    });
  });
});