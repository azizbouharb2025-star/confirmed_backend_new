const fc = require('fast-check');
const mongoose = require('mongoose');
const Order = require('../../src/models/Order');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const Product = require('../../src/models/Product');
const orderService = require('../../src/services/orderService');

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
  priority: priorityArbitrary,
  aiRiskScore: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  region: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined })
});

// Helper to create orders in database
async function createTestOrders(ordersData, shopId) {
  const orders = [];
  for (let i = 0; i < ordersData.length; i++) {
    const data = ordersData[i];
    const order = new Order({
      ...data,
      orderId: `${data.orderId}_${i}_${Date.now()}`,
      shopId,
      items: [{ name: 'Test Item', quantity: 1, price: data.totalAmount }]
    });
    await order.save();
    orders.push(order);
  }
  return orders;
}

describe('Order Service Property Tests', () => {
  let shopId;
  let user;

  beforeEach(() => {
    shopId = new mongoose.Types.ObjectId();
    user = { shopId, role: 'shop_owner' };
  });


  /**
   * **Feature: orders-api-enhancement, Property 1: Pagination Response Structure**
   * *For any* valid orders list request, the response SHALL contain `orders` (array), 
   * `total` (number), `page` (number), `limit` (number), and `totalPages` (number) fields.
   * **Validates: Requirements 1.1**
   */
  describe('Property 1: Pagination Response Structure', () => {
    it('should return response with all required pagination fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 0, maxLength: 10 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 50 }),
          async (ordersData, page, limit) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Execute
            const result = await orderService.findOrders({ page, limit }, user);

            // Verify structure
            expect(result).toHaveProperty('orders');
            expect(result).toHaveProperty('total');
            expect(result).toHaveProperty('page');
            expect(result).toHaveProperty('limit');
            expect(result).toHaveProperty('totalPages');

            // Verify types
            expect(Array.isArray(result.orders)).toBe(true);
            expect(typeof result.total).toBe('number');
            expect(typeof result.page).toBe('number');
            expect(typeof result.limit).toBe('number');
            expect(typeof result.totalPages).toBe('number');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 2: Pagination Correctness**
   * *For any* dataset of orders and pagination parameters (page, limit), the number of 
   * returned orders SHALL equal `min(limit, total - (page-1) * limit)` and `totalPages` 
   * SHALL equal `ceil(total / limit)`.
   * **Validates: Requirements 1.2**
   */
  describe('Property 2: Pagination Correctness', () => {
    it('should return correct number of orders and totalPages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 10 }),
          async (ordersData, page, limit) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Execute
            const result = await orderService.findOrders({ page, limit }, user);

            // Verify pagination math
            const expectedTotalPages = Math.ceil(result.total / limit);
            const expectedOrderCount = Math.max(0, Math.min(limit, result.total - (page - 1) * limit));

            expect(result.totalPages).toBe(expectedTotalPages);
            expect(result.orders.length).toBe(expectedOrderCount);
            expect(result.page).toBe(page);
            expect(result.limit).toBe(limit);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 3: Search Filter Correctness**
   * *For any* search term and dataset, all returned orders SHALL contain the search term 
   * (case-insensitive) in at least one of: `orderId`, `clientInfo.name`, or `clientInfo.phone`.
   * **Validates: Requirements 1.3**
   */
  describe('Property 3: Search Filter Correctness', () => {
    it('should return only orders matching search term', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 2, maxLength: 5 }).filter(s => s.trim().length >= 2),
          async (ordersData, searchTerm) => {
            // Setup
            const orders = await createTestOrders(ordersData, shopId);

            // Execute
            const result = await orderService.findOrders({ search: searchTerm }, user);

            // Verify all returned orders match search
            const searchLower = searchTerm.toLowerCase();
            for (const order of result.orders) {
              const matchesOrderId = order.orderId.toLowerCase().includes(searchLower);
              const matchesName = order.clientInfo.name.toLowerCase().includes(searchLower);
              const matchesPhone = order.clientInfo.phone.toLowerCase().includes(searchLower);
              
              expect(matchesOrderId || matchesName || matchesPhone).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 4: Status Filter Correctness**
   * *For any* status filter value and dataset, all returned orders SHALL have a `status` 
   * field equal to the filter value.
   * **Validates: Requirements 1.4**
   */
  describe('Property 4: Status Filter Correctness', () => {
    it('should return only orders with matching status', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 10 }),
          statusArbitrary,
          async (ordersData, filterStatus) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Execute
            const result = await orderService.findOrders({ status: filterStatus }, user);

            // Verify all returned orders have matching status
            for (const order of result.orders) {
              expect(order.status).toBe(filterStatus);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 5: Date Range Filter Correctness**
   * *For any* startDate and endDate filter values and dataset, all returned orders SHALL 
   * have `createdAt` >= startDate AND `createdAt` <= endDate.
   * **Validates: Requirements 1.5**
   */
  describe('Property 5: Date Range Filter Correctness', () => {
    it('should return only orders within date range', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 10 }),
          async (ordersData) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Use a date range that includes now
            const now = new Date();
            const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
            const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day from now

            // Execute
            const result = await orderService.findOrders({ startDate, endDate }, user);

            // Verify all returned orders are within date range
            for (const order of result.orders) {
              const createdAt = new Date(order.createdAt);
              expect(createdAt >= startDate).toBe(true);
              expect(createdAt <= endDate).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 6: Sort Order Correctness**
   * *For any* sortBy field, sortOrder direction, and dataset, each consecutive pair of 
   * orders (order[i], order[i+1]) SHALL maintain the sort invariant based on the specified 
   * field and direction.
   * **Validates: Requirements 1.6**
   */
  describe('Property 6: Sort Order Correctness', () => {
    it('should return orders in correct sort order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 2, maxLength: 5 }),
          fc.constantFrom('createdAt', 'totalAmount', 'status'),
          fc.constantFrom('asc', 'desc'),
          async (ordersData, sortBy, sortOrder) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Execute
            const result = await orderService.findOrders({ sortBy, sortOrder, limit: 100 }, user);

            // Verify sort order
            for (let i = 0; i < result.orders.length - 1; i++) {
              const current = result.orders[i][sortBy];
              const next = result.orders[i + 1][sortBy];

              if (sortOrder === 'asc') {
                expect(current <= next).toBe(true);
              } else {
                expect(current >= next).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);
  });


  /**
   * **Feature: orders-api-enhancement, Property 7: Order Retrieval Correctness**
   * *For any* existing order ID and authorized user, the returned order SHALL match all 
   * fields of the stored order document.
   * **Validates: Requirements 2.1**
   */
  describe('Property 7: Order Retrieval Correctness', () => {
    it('should return complete order matching stored document', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          async (orderData) => {
            // Setup - create a single order
            const orders = await createTestOrders([orderData], shopId);
            const createdOrder = orders[0];

            // Execute
            const result = await orderService.findOrderById(createdOrder._id, user);

            // Verify key fields match
            expect(result._id.toString()).toBe(createdOrder._id.toString());
            expect(result.orderId).toBe(createdOrder.orderId);
            expect(result.clientInfo.name).toBe(createdOrder.clientInfo.name);
            expect(result.clientInfo.phone).toBe(createdOrder.clientInfo.phone);
            expect(result.totalAmount).toBe(createdOrder.totalAmount);
            expect(result.status).toBe(createdOrder.status);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 8: Non-Existent Resource Returns 404**
   * *For any* request targeting a non-existent order ID (GET, PATCH status, PATCH assign), 
   * the System SHALL return HTTP 404 status with an error message.
   * **Validates: Requirements 2.2, 3.3, 4.2**
   */
  describe('Property 8: Non-Existent Resource Returns 404', () => {
    it('should throw 404 error for non-existent order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(new mongoose.Types.ObjectId()),
          async (nonExistentId) => {
            // Test findOrderById
            try {
              await orderService.findOrderById(nonExistentId, user);
              fail('Should have thrown an error');
            } catch (error) {
              expect(error.statusCode).toBe(404);
              expect(error.message).toBe('Order not found');
            }

            // Test updateOrderStatus
            try {
              await orderService.updateOrderStatus(nonExistentId, 'confirmed', '', user);
              fail('Should have thrown an error');
            } catch (error) {
              expect(error.statusCode).toBe(404);
            }

            // Test assignOperator
            try {
              await orderService.assignOperator(nonExistentId, new mongoose.Types.ObjectId(), user);
              fail('Should have thrown an error');
            } catch (error) {
              expect(error.statusCode).toBe(404);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 10: Status Update Persistence**
   * *For any* order and valid status value, after a status update operation, the order's 
   * `status` field SHALL equal the new status value.
   * **Validates: Requirements 3.1**
   */
  describe('Property 10: Status Update Persistence', () => {
    it('should persist new status after update', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          statusArbitrary,
          async (orderData, newStatus) => {
            // Setup
            const orders = await createTestOrders([orderData], shopId);
            const createdOrder = orders[0];
            const operatorUser = { ...user, _id: new mongoose.Types.ObjectId() };

            // Execute
            const result = await orderService.updateOrderStatus(
              createdOrder._id, 
              newStatus, 
              'Test notes', 
              operatorUser
            );

            // Verify status is updated
            expect(result.status).toBe(newStatus);

            // Verify persistence by fetching again
            const fetchedOrder = await Order.findById(createdOrder._id);
            expect(fetchedOrder.status).toBe(newStatus);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 11: Call History Growth on Status Update**
   * *For any* operator status update, the order's `callHistory` array length SHALL increase 
   * by exactly 1, and the new entry SHALL contain `operatorId`, `timestamp`, and `result` fields.
   * **Validates: Requirements 3.2**
   */
  describe('Property 11: Call History Growth on Status Update', () => {
    it('should add exactly one call history entry with required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          statusArbitrary,
          async (orderData, newStatus) => {
            // Setup
            const orders = await createTestOrders([orderData], shopId);
            const createdOrder = orders[0];
            const initialHistoryLength = createdOrder.callHistory.length;
            const operatorId = new mongoose.Types.ObjectId();
            const operatorUser = { ...user, _id: operatorId };

            // Execute
            const result = await orderService.updateOrderStatus(
              createdOrder._id, 
              newStatus, 
              'Test notes', 
              operatorUser
            );

            // Verify call history grew by exactly 1
            expect(result.callHistory.length).toBe(initialHistoryLength + 1);

            // Verify new entry has required fields
            const newEntry = result.callHistory[result.callHistory.length - 1];
            expect(newEntry.operatorId.toString()).toBe(operatorId.toString());
            expect(newEntry.timestamp).toBeDefined();
            expect(newEntry.result).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 12: Operator Assignment Persistence**
   * *For any* order and operator ID, after an assignment operation by an admin, the order's 
   * `assignedOperatorId` SHALL equal the specified operator ID.
   * **Validates: Requirements 4.1**
   */
  describe('Property 12: Operator Assignment Persistence', () => {
    it('should persist operator assignment', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderArbitrary,
          fc.constant(new mongoose.Types.ObjectId()),
          async (orderData, operatorId) => {
            // Setup
            const orders = await createTestOrders([orderData], shopId);
            const createdOrder = orders[0];
            const adminUser = { ...user, role: 'admin' };

            // Execute
            const result = await orderService.assignOperator(
              createdOrder._id, 
              operatorId, 
              adminUser
            );

            // Verify assignment
            expect(result.assignedOperatorId.toString()).toBe(operatorId.toString());

            // Verify persistence
            const fetchedOrder = await Order.findById(createdOrder._id);
            expect(fetchedOrder.assignedOperatorId.toString()).toBe(operatorId.toString());
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 14: Bulk Operation Response Structure**
   * *For any* bulk status update request with N order IDs, the response SHALL contain 
   * `successful` + `failed` = N, and `errors` array length SHALL equal `failed`.
   * **Validates: Requirements 5.1**
   */
  describe('Property 14: Bulk Operation Response Structure', () => {
    it('should return correct bulk operation response structure', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 5 }),
          statusArbitrary,
          async (ordersData, newStatus) => {
            // Setup
            const orders = await createTestOrders(ordersData, shopId);
            const orderIds = orders.map(o => o._id.toString());
            const operatorUser = { ...user, _id: new mongoose.Types.ObjectId() };

            // Execute
            const result = await orderService.bulkUpdateStatus(orderIds, newStatus, operatorUser);

            // Verify structure
            expect(result).toHaveProperty('successful');
            expect(result).toHaveProperty('failed');
            expect(result).toHaveProperty('errors');

            // Verify math: successful + failed = N
            expect(result.successful + result.failed).toBe(orderIds.length);

            // Verify errors array length equals failed count
            expect(result.errors.length).toBe(result.failed);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 15: Bulk Operation Partial Failure Handling**
   * *For any* bulk request containing both valid and invalid order IDs, all valid orders 
   * SHALL be updated successfully regardless of invalid orders in the same request.
   * **Validates: Requirements 5.2, 5.3**
   */
  describe('Property 15: Bulk Operation Partial Failure Handling', () => {
    it('should process valid orders even when some are invalid', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 3 }),
          fc.integer({ min: 1, max: 3 }),
          statusArbitrary,
          async (ordersData, numInvalid, newStatus) => {
            // Setup - create valid orders
            const orders = await createTestOrders(ordersData, shopId);
            const validOrderIds = orders.map(o => o._id.toString());
            
            // Add invalid order IDs
            const invalidOrderIds = Array.from({ length: numInvalid }, () => 
              new mongoose.Types.ObjectId().toString()
            );
            
            const allOrderIds = [...validOrderIds, ...invalidOrderIds];
            const operatorUser = { ...user, _id: new mongoose.Types.ObjectId() };

            // Execute
            const result = await orderService.bulkUpdateStatus(allOrderIds, newStatus, operatorUser);

            // Verify valid orders were updated
            expect(result.successful).toBe(validOrderIds.length);
            expect(result.failed).toBe(numInvalid);

            // Verify each valid order was actually updated
            for (const orderId of validOrderIds) {
              const order = await Order.findById(orderId);
              expect(order.status).toBe(newStatus);
            }

            // Verify errors contain invalid order IDs
            for (const error of result.errors) {
              expect(invalidOrderIds).toContain(error.orderId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
