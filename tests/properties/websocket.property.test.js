const fc = require('fast-check');
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const Order = require('../../src/models/Order');
const { authenticateSocket } = require('../../src/websocket/socketAuth');
const { setupOrderEvents, emitOrderUpdate, emitOrderNew, emitOrderDelete, clearEventStore, getEventsSinceTimestamp } = require('../../src/websocket/orderEvents');

// Set JWT_SECRET for tests
process.env.JWT_SECRET = 'test-jwt-secret';

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

describe('WebSocket Property Tests', () => {
  let httpServer;
  let io;
  let serverPort;
  let testUser;
  let testShopId;

  beforeAll(async () => {
    // Create test server
    const app = express();
    httpServer = http.createServer(app);
    io = new Server(httpServer, {
      cors: { origin: '*' }
    });

    // Apply authentication middleware
    io.use(authenticateSocket);
    
    // Setup order events
    setupOrderEvents(io);

    // Start server on random port
    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address().port;
        resolve();
      });
    });
  });


  afterAll(async () => {
    io.close();
    httpServer.close();
  });

  beforeEach(async () => {
    testShopId = new mongoose.Types.ObjectId();
    
    // Clear event store before each test
    clearEventStore();
    
    // Create test user with all required fields
    testUser = await User.create({
      email: `test-${Date.now()}@example.com`,
      password: 'testpassword123',
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: '+1234567890',
      whatsappNumber: '+1234567890',
      isWhatsappLinked: true,
      country: 'Tunisia',
      role: 'shop_owner',
      shopId: testShopId
    });
  });

  // Helper to create valid JWT token
  function createValidToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  }

  // Helper to create client connection
  function createClient(token) {
    return Client(`http://localhost:${serverPort}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      timeout: 5000
    });
  }

  /**
   * **Feature: orders-api-enhancement, Property 28: WebSocket Authentication**
   * *For any* WebSocket connection attempt with an invalid or missing token, 
   * the System SHALL reject the connection.
   * **Validates: Requirements 11.4**
   */
  describe('Property 28: WebSocket Authentication', () => {
    it('should reject connections with missing token', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const client = Client(`http://localhost:${serverPort}`, {
              transports: ['websocket'],
              forceNew: true,
              timeout: 3000
            });

            const result = await new Promise((resolve) => {
              client.on('connect', () => {
                client.disconnect();
                resolve({ connected: true });
              });
              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ connected: false, error: err.message });
              });
              setTimeout(() => {
                client.disconnect();
                resolve({ connected: false, error: 'timeout' });
              }, 3000);
            });

            expect(result.connected).toBe(false);
            expect(result.error).toContain('Authentication error');
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should reject connections with invalid token', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 100 }),
          async (invalidToken) => {
            const client = createClient(invalidToken);

            const result = await new Promise((resolve) => {
              client.on('connect', () => {
                client.disconnect();
                resolve({ connected: true });
              });
              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ connected: false, error: err.message });
              });
              setTimeout(() => {
                client.disconnect();
                resolve({ connected: false, error: 'timeout' });
              }, 3000);
            });

            expect(result.connected).toBe(false);
            expect(result.error).toContain('Authentication error');
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should accept connections with valid token', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const token = createValidToken(testUser._id);
            const client = createClient(token);

            const result = await new Promise((resolve) => {
              client.on('connect', () => {
                client.disconnect();
                resolve({ connected: true });
              });
              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ connected: false, error: err.message });
              });
              setTimeout(() => {
                client.disconnect();
                resolve({ connected: false, error: 'timeout' });
              }, 5000);
            });

            expect(result.connected).toBe(true);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should reject connections with token for non-existent user', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(new mongoose.Types.ObjectId()),
          async (fakeUserId) => {
            const token = jwt.sign({ id: fakeUserId }, process.env.JWT_SECRET, { expiresIn: '1h' });
            const client = createClient(token);

            const result = await new Promise((resolve) => {
              client.on('connect', () => {
                client.disconnect();
                resolve({ connected: true });
              });
              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ connected: false, error: err.message });
              });
              setTimeout(() => {
                client.disconnect();
                resolve({ connected: false, error: 'timeout' });
              }, 3000);
            });

            expect(result.connected).toBe(false);
            expect(result.error).toContain('Authentication error');
          }
        ),
        { numRuns: 10 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 25: WebSocket Order Update Message Format**
   * *For any* successful order update, the System SHALL emit a WebSocket message with 
   * `type: 'order:update'`, `payload` containing the full Order object, and `timestamp` 
   * as a valid ISO 8601 string.
   * **Validates: Requirements 11.1**
   */
  describe('Property 25: WebSocket Order Update Message Format', () => {
    it('should emit order:update event with new message format { type, payload, timestamp }', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          statusArbitrary,
          async (orderData, newStatus) => {
            // Create order in database
            const order = new Order({
              ...orderData,
              orderId: `${orderData.orderId}_${Date.now()}`,
              shopId: testShopId,
              items: [{ name: 'Test Item', quantity: 1, price: orderData.totalAmount }],
              status: newStatus
            });
            await order.save();

            // Connect client with valid token
            const token = createValidToken(testUser._id);
            const client = createClient(token);

            const result = await new Promise((resolve) => {
              let eventReceived = null;

              client.on('connect', () => {
                // Wait a bit for room subscription, then emit
                setTimeout(() => {
                  emitOrderUpdate(order);
                }, 100);
              });

              client.on('order:update', (data) => {
                eventReceived = data;
                client.disconnect();
                resolve({ received: true, data: eventReceived });
              });

              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ received: false, error: err.message });
              });

              // Timeout
              setTimeout(() => {
                client.disconnect();
                resolve({ received: eventReceived !== null, data: eventReceived });
              }, 3000);
            });

            // Verify event was received with correct new message format
            expect(result.received).toBe(true);
            expect(result.data).toHaveProperty('type', 'order:update');
            expect(result.data).toHaveProperty('payload');
            expect(result.data).toHaveProperty('timestamp');
            // Verify timestamp is valid ISO 8601
            expect(new Date(result.data.timestamp).toISOString()).toBe(result.data.timestamp);
            // Verify payload contains the order
            expect(result.data.payload._id.toString()).toBe(order._id.toString());
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 26: WebSocket Order New Message Format**
   * *For any* successful order creation, the System SHALL emit a WebSocket message with 
   * `type: 'order:new'`, `payload` containing the full Order object, and `timestamp` 
   * as a valid ISO 8601 string.
   * **Validates: Requirements 11.2**
   */
  describe('Property 26: WebSocket Order New Message Format', () => {
    it('should emit order:new event with new message format { type, payload, timestamp }', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Create order in database
            const order = new Order({
              ...orderData,
              orderId: `${orderData.orderId}_${Date.now()}`,
              shopId: testShopId,
              items: [{ name: 'Test Item', quantity: 1, price: orderData.totalAmount }]
            });
            await order.save();

            // Connect client with valid token
            const token = createValidToken(testUser._id);
            const client = createClient(token);

            const result = await new Promise((resolve) => {
              let eventReceived = null;

              client.on('connect', () => {
                // Wait a bit for room subscription, then emit
                setTimeout(() => {
                  emitOrderNew(order);
                }, 100);
              });

              client.on('order:new', (data) => {
                eventReceived = data;
                client.disconnect();
                resolve({ received: true, data: eventReceived });
              });

              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ received: false, error: err.message });
              });

              // Timeout
              setTimeout(() => {
                client.disconnect();
                resolve({ received: eventReceived !== null, data: eventReceived });
              }, 3000);
            });

            // Verify event was received with correct new message format
            expect(result.received).toBe(true);
            expect(result.data).toHaveProperty('type', 'order:new');
            expect(result.data).toHaveProperty('payload');
            expect(result.data).toHaveProperty('timestamp');
            // Verify timestamp is valid ISO 8601
            expect(new Date(result.data.timestamp).toISOString()).toBe(result.data.timestamp);
            // Verify payload contains the order
            expect(result.data.payload._id.toString()).toBe(order._id.toString());
          }
        ),
        { numRuns: 20 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 27: WebSocket Order Delete Message Format**
   * *For any* successful order deletion, the System SHALL emit a WebSocket message with 
   * `type: 'order:delete'`, `payload` containing only `{ orderId: string }`, and `timestamp` 
   * as a valid ISO 8601 string.
   * **Validates: Requirements 11.3**
   */
  describe('Property 27: WebSocket Order Delete Message Format', () => {
    it('should emit order:delete event with { type, payload: { orderId }, timestamp }', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Create order in database
            const order = new Order({
              ...orderData,
              orderId: `${orderData.orderId}_${Date.now()}`,
              shopId: testShopId,
              items: [{ name: 'Test Item', quantity: 1, price: orderData.totalAmount }]
            });
            await order.save();

            // Connect client with valid token
            const token = createValidToken(testUser._id);
            const client = createClient(token);

            const result = await new Promise((resolve) => {
              let eventReceived = null;

              client.on('connect', () => {
                // Wait a bit for room subscription, then emit
                setTimeout(() => {
                  emitOrderDelete(order._id, testShopId);
                }, 100);
              });

              client.on('order:delete', (data) => {
                eventReceived = data;
                client.disconnect();
                resolve({ received: true, data: eventReceived });
              });

              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ received: false, error: err.message });
              });

              // Timeout
              setTimeout(() => {
                client.disconnect();
                resolve({ received: eventReceived !== null, data: eventReceived });
              }, 3000);
            });

            // Verify event was received with correct message format
            expect(result.received).toBe(true);
            expect(result.data).toHaveProperty('type', 'order:delete');
            expect(result.data).toHaveProperty('payload');
            expect(result.data).toHaveProperty('timestamp');
            // Verify timestamp is valid ISO 8601
            expect(new Date(result.data.timestamp).toISOString()).toBe(result.data.timestamp);
            // Verify payload contains only orderId
            expect(result.data.payload).toHaveProperty('orderId');
            expect(result.data.payload.orderId).toBe(order._id.toString());
            // Verify payload does NOT contain full order object
            expect(result.data.payload).not.toHaveProperty('clientInfo');
            expect(result.data.payload).not.toHaveProperty('totalAmount');
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 29: WebSocket Sync Request Response**
   * *For any* `sync:request` message with a `since` timestamp, the System SHALL respond 
   * with all order events (new, update, delete) that occurred after that timestamp.
   * **Validates: Requirements 11.5**
   */
  describe('Property 29: WebSocket Sync Request Response', () => {
    it('should respond to sync:request with events since the given timestamp', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 5 }),
          async (ordersData) => {
            // Record timestamp before creating orders
            const sinceTimestamp = new Date().toISOString();
            
            // Wait a bit to ensure timestamp difference
            await new Promise(r => setTimeout(r, 50));
            
            // Create orders and emit events
            const createdOrders = [];
            for (const orderData of ordersData) {
              const order = new Order({
                ...orderData,
                orderId: `${orderData.orderId}_${Date.now()}_${Math.random()}`,
                shopId: testShopId,
                items: [{ name: 'Test Item', quantity: 1, price: orderData.totalAmount }]
              });
              await order.save();
              createdOrders.push(order);
              emitOrderNew(order);
            }

            // Connect client with valid token
            const token = createValidToken(testUser._id);
            const client = createClient(token);

            const result = await new Promise((resolve) => {
              client.on('connect', () => {
                // Send sync request
                setTimeout(() => {
                  client.emit('sync:request', { payload: { since: sinceTimestamp } });
                }, 100);
              });

              client.on('sync:response', (data) => {
                client.disconnect();
                resolve({ received: true, data });
              });

              client.on('sync:error', (data) => {
                client.disconnect();
                resolve({ received: false, error: data.error });
              });

              client.on('connect_error', (err) => {
                client.disconnect();
                resolve({ received: false, error: err.message });
              });

              // Timeout
              setTimeout(() => {
                client.disconnect();
                resolve({ received: false, error: 'timeout' });
              }, 5000);
            });

            // Verify response
            expect(result.received).toBe(true);
            expect(result.data).toHaveProperty('events');
            expect(Array.isArray(result.data.events)).toBe(true);
            
            // All events should have proper structure
            for (const event of result.data.events) {
              expect(event).toHaveProperty('type');
              expect(event).toHaveProperty('payload');
              expect(event).toHaveProperty('timestamp');
              expect(['order:new', 'order:update', 'order:delete']).toContain(event.type);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should return error for sync:request without since timestamp', async () => {
      const token = createValidToken(testUser._id);
      const client = createClient(token);

      const result = await new Promise((resolve) => {
        client.on('connect', () => {
          client.emit('sync:request', {});
        });

        client.on('sync:error', (data) => {
          client.disconnect();
          resolve({ error: true, message: data.error });
        });

        client.on('sync:response', () => {
          client.disconnect();
          resolve({ error: false });
        });

        setTimeout(() => {
          client.disconnect();
          resolve({ error: false, timeout: true });
        }, 3000);
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('since');
    });
  });
});
