const orderService = require('./orderService');
const logger = require('../utils/logger');
const XLSX = require('xlsx');

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

  // ─── INTIGO EXPORT HELPERS ─────────────────────────────────────────────────

  /**
   * Build a clean address string from an order's clientInfo.address.
   * Skips null/undefined/empty parts so the output never contains "undefined".
   * @param {Object} address - clientInfo.address
   * @returns {string}
   */
  static buildAddress(address) {
    if (!address) return '';
    const parts = [address.street, address.city].filter(v => v && v.trim() !== '');
    return parts.join(', ');
  }

  /**
   * Format an order's items array into a readable product string.
   * e.g. "T-Shirt x2 | Pants x1"
   * @param {Array} items
   * @returns {string}
   */
  static formatItems(items) {
    if (!Array.isArray(items) || items.length === 0) return '';
    return items
      .map(item => {
        const name = (item.name || '').trim();
        const qty = item.quantity || 1;
        return name ? `${name} x${qty}` : `x${qty}`;
      })
      .filter(s => s)
      .join(' | ');
  }

  /**
   * Map a single order to an Intigo row object.
   * Columns: Nom, Téléphone, Adresse, Ville, Montant, Produit
   * @param {Object} order
   * @returns {Object}
   */
  static mapOrderToIntigo(order) {
    const address = order.clientInfo?.address || {};
    return {
      'Nom':       order.clientInfo?.name    || '',
      'Téléphone': order.clientInfo?.phone   || '',
      'Adresse':   ExportService.buildAddress(address),
      'Ville':     address.city              || order.region || '',
      'Montant':   order.totalAmount         != null ? order.totalAmount : '',
      'Produit':   ExportService.formatItems(order.items)
    };
  }

  /**
   * Fetch orders by IDs (scoped to the requesting user's shop).
   * @param {string[]} orderIds  - Optional explicit list; if empty, fetches all for shop.
   * @param {Object}   user
   * @returns {Promise<Array>}
   */
  async fetchOrdersForExport(orderIds, user) {
    const filters = { page: 1, limit: 10000 };
    const result = await orderService.findOrders(filters, user);
    let orders = result.orders;
    if (Array.isArray(orderIds) && orderIds.length > 0) {
      const idSet = new Set(orderIds.map(String));
      orders = orders.filter(o => idSet.has(String(o._id)));
    }
    return orders;
  }

  /**
   * Export selected orders in Intigo format as CSV.
   * Headers: Nom,Téléphone,Adresse,Ville,Montant,Produit
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<string>} CSV string (UTF-8, with BOM for Excel)
   */
  async exportIntigoCSV(orderIds, user) {
    try {
      const orders = await this.fetchOrdersForExport(orderIds, user);
      const headers = ['Nom', 'Téléphone', 'Adresse', 'Ville', 'Montant', 'Produit'];
      const rows = orders.map(order => {
        const row = ExportService.mapOrderToIntigo(order);
        return headers.map(h => escapeCSVField(row[h])).join(',');
      });
      // UTF-8 BOM so Excel opens it correctly
      return '\uFEFF' + [headers.map(escapeCSVField).join(','), ...rows].join('\n');
    } catch (error) {
      logger.error('Error exporting Intigo CSV:', error);
      throw error;
    }
  }

  /**
   * Export selected orders in Intigo format as XLSX.
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<Buffer>} XLSX buffer
   */
  async exportIntigoXLSX(orderIds, user) {
    try {
      const orders = await this.fetchOrdersForExport(orderIds, user);
      const headers = ['Nom', 'Téléphone', 'Adresse', 'Ville', 'Montant', 'Produit'];
      const data = [
        headers,
        ...orders.map(order => {
          const row = ExportService.mapOrderToIntigo(order);
          return headers.map(h => row[h]);
        })
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Intigo');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      logger.error('Error exporting Intigo XLSX:', error);
      throw error;
    }
  }
}

module.exports = new ExportService();
