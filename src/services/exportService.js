const orderService = require('./orderService');
const logger = require('../utils/logger');

/**
 * CSV field escaping - handles quotes, commas, and newlines
 * @param {*} value - Value to escape
 * @returns {string} Escaped CSV field
 */
function escapeCSVField(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  const stringValue = String(value);
  
  // Check if escaping is needed (contains comma, quote, or newline)
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
    // Escape quotes by doubling them and wrap in quotes
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  
  return stringValue;
}

/**
 * Format date for CSV export
 * @param {Date} date - Date to format
 * @returns {string} ISO formatted date string
 */
function formatDate(date) {
  if (!date) return '';
  return new Date(date).toISOString();
}

class ExportService {
  /**
   * Standard CSV headers for order export
   */
  static get CSV_HEADERS() {
    return [
      'orderId',
      'clientInfo.name',
      'clientInfo.phone',
      'totalAmount',
      'status',
      'priority',
      'createdAt'
    ];
  }

  /**
   * Export orders to CSV format
   * @param {Object} filters - Filter parameters (same as findOrders)
   * @param {Object} user - Current user
   * @returns {Promise<string>} CSV string with headers and data
   */
  async exportOrdersToCSV(filters = {}, user = {}) {
    try {
      // Remove pagination limits for export - get all matching orders
      const exportFilters = {
        ...filters,
        page: 1,
        limit: 10000 // High limit to get all orders
      };

      const result = await orderService.findOrders(exportFilters, user);
      const orders = result.orders;

      // Build CSV content
      const rows = [];

      // Add header row
      rows.push(ExportService.CSV_HEADERS.map(escapeCSVField).join(','));

      // Add data rows
      for (const order of orders) {
        const row = [
          escapeCSVField(order.orderId),
          escapeCSVField(order.clientInfo?.name),
          escapeCSVField(order.clientInfo?.phone),
          escapeCSVField(order.totalAmount),
          escapeCSVField(order.status),
          escapeCSVField(order.priority),
          escapeCSVField(formatDate(order.createdAt))
        ];
        rows.push(row.join(','));
      }

      return rows.join('\n');
    } catch (error) {
      logger.error('Error exporting orders to CSV:', error);
      throw error;
    }
  }

  /**
   * Get orders matching filters (for testing filter consistency)
   * @param {Object} filters - Filter parameters
   * @param {Object} user - Current user
   * @returns {Promise<Array>} Array of orders
   */
  async getFilteredOrders(filters = {}, user = {}) {
    const exportFilters = {
      ...filters,
      page: 1,
      limit: 10000
    };
    const result = await orderService.findOrders(exportFilters, user);
    return result.orders;
  }
}

module.exports = new ExportService();
