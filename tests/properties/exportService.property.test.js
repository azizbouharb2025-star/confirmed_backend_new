const fc = require('fast-check');
const mongoose = require('mongoose');
const Order = require('../../src/models/Order');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const exportService = require('../../src/services/exportService');

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

/**
 * Parse CSV string into rows and columns
 * Handles quoted fields with commas, escaped quotes, and newlines within quotes
 */
function parseCSV(csvString) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvString.length; i++) {
    const char = csvString[i];
    const nextChar = csvString[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
      } else {
        // Include any character (including newlines) within quotes
        currentField += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        // End of row (handle both \n and \r\n)
        if (char === '\r') i++; // Skip \n in \r\n
        currentRow.push(currentField);
        if (currentRow.length > 0 && currentRow.some(f => f !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char !== '\r') {
        currentField += char;
      }
    }
  }
  
  // Push last field and row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.length > 0 && currentRow.some(f => f !== '')) {
      rows.push(currentRow);
    }
  }
  
  return rows;
}

describe('Export Service Property Tests', () => {
  let shopId;
  let user;

  beforeEach(() => {
    shopId = new mongoose.Types.ObjectId();
    user = { shopId, role: 'shop_owner' };
  });

  /**
   * **Feature: orders-api-enhancement, Property 16: CSV Export Format Validity**
   * *For any* export request, the response SHALL be valid CSV format with properly 
   * escaped fields and consistent column count per row.
   * **Validates: Requirements 6.1**
   */
  describe('Property 16: CSV Export Format Validity', () => {
    it('should generate valid CSV with consistent column count per row', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 0, maxLength: 10 }),
          async (ordersData) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Execute
            const csv = await exportService.exportOrdersToCSV({}, user);

            // Parse CSV
            const rows = parseCSV(csv);
            
            // Must have at least header row
            expect(rows.length).toBeGreaterThanOrEqual(1);
            
            // Get expected column count from header
            const headerColumnCount = rows[0].length;
            expect(headerColumnCount).toBe(7); // 7 standard headers
            
            // All rows must have same column count
            for (let i = 0; i < rows.length; i++) {
              expect(rows[i].length).toBe(headerColumnCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });


    it('should properly escape fields containing special characters', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate strings with special CSV characters
          fc.record({
            orderId: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
            clientInfo: fc.record({
              name: fc.oneof(
                fc.constant('John, Doe'),
                fc.constant('Jane "The Great" Smith'),
                fc.constant('Bob\nNewline'),
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0)
              ),
              phone: fc.constant('+1234567890'),
              email: fc.emailAddress()
            }),
            totalAmount: fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
            status: statusArbitrary,
            priority: priorityArbitrary
          }),
          async (orderData) => {
            // Setup
            await createTestOrders([orderData], shopId);

            // Execute
            const csv = await exportService.exportOrdersToCSV({}, user);

            // Parse CSV - should not throw
            const rows = parseCSV(csv);
            
            // Should have header + at least 1 data row
            expect(rows.length).toBeGreaterThanOrEqual(2);
            
            // All rows should have consistent column count
            const headerColumnCount = rows[0].length;
            for (const row of rows) {
              expect(row.length).toBe(headerColumnCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 17: CSV Export Filter Consistency**
   * *For any* export request with filters, the exported orders SHALL match exactly 
   * the orders returned by the list endpoint with the same filters.
   * **Validates: Requirements 6.2**
   */
  describe('Property 17: CSV Export Filter Consistency', () => {
    it('should export same orders as list endpoint with same filters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 1, maxLength: 10 }),
          statusArbitrary,
          async (ordersData, filterStatus) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            const filters = { status: filterStatus };

            // Get orders via list endpoint
            const listOrders = await exportService.getFilteredOrders(filters, user);

            // Get CSV export
            const csv = await exportService.exportOrdersToCSV(filters, user);
            const rows = parseCSV(csv);
            
            // Subtract 1 for header row
            const csvDataRowCount = rows.length - 1;

            // CSV should have same number of orders as list
            expect(csvDataRowCount).toBe(listOrders.length);

            // Verify each exported order matches a list order by orderId
            const listOrderIds = new Set(listOrders.map(o => o.orderId));
            for (let i = 1; i < rows.length; i++) {
              const csvOrderId = rows[i][0]; // orderId is first column
              expect(listOrderIds.has(csvOrderId)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 18: CSV Export Headers Completeness**
   * *For any* CSV export, the header row SHALL contain columns for: orderId, 
   * clientInfo.name, clientInfo.phone, totalAmount, status, priority, createdAt.
   * **Validates: Requirements 6.3**
   */
  describe('Property 18: CSV Export Headers Completeness', () => {
    it('should include all required headers in CSV export', async () => {
      const requiredHeaders = [
        'orderId',
        'clientInfo.name',
        'clientInfo.phone',
        'totalAmount',
        'status',
        'priority',
        'createdAt'
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArbitrary, { minLength: 0, maxLength: 5 }),
          async (ordersData) => {
            // Setup
            await createTestOrders(ordersData, shopId);

            // Execute
            const csv = await exportService.exportOrdersToCSV({}, user);

            // Parse CSV
            const rows = parseCSV(csv);
            
            // Must have at least header row
            expect(rows.length).toBeGreaterThanOrEqual(1);
            
            // Get headers from first row
            const headers = rows[0];

            // Verify all required headers are present
            for (const requiredHeader of requiredHeaders) {
              expect(headers).toContain(requiredHeader);
            }

            // Verify headers are in expected order
            expect(headers).toEqual(requiredHeaders);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
