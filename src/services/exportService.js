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
      ExportService.autoSizeWorksheetColumns(ws, data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Intigo');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      logger.error('Error exporting Intigo XLSX:', error);
      throw error;
    }
  }

  // ─── ARAMEX EXPORT ─────────────────────────────────────────────────────────

  /**
   * Map a single order to an Aramex row object.
   * Columns: Nom, Téléphone, Adresse, Gouvernorat, Produit, COD
   *
   * Field mapping:
   *   Nom         → clientInfo.name
   *   Téléphone   → clientInfo.phone
   *   Adresse     → buildAddress(clientInfo.address)
   *   Gouvernorat → clientInfo.address.state → order.region → clientInfo.address.city
   *   Produit     → formatItems(items)
   *   COD         → totalAmount
   *
   * @param {Object} order
   * @returns {Object}
   */
  static mapOrderToAramex(order) {
    const address = order.clientInfo?.address || {};
    const gouvernorat = address.state || order.region || address.city || '';
    return {
      'Nom':         order.clientInfo?.name  || '',
      'Téléphone':   order.clientInfo?.phone || '',
      'Adresse':     ExportService.buildAddress(address),
      'Gouvernorat': gouvernorat,
      'Produit':     ExportService.formatItems(order.items),
      'COD':         order.totalAmount != null ? order.totalAmount : ''
    };
  }

  /**
   * Export selected orders in Aramex format as CSV.
   * Headers: Nom,Téléphone,Adresse,Gouvernorat,Produit,COD
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<string>} CSV string (UTF-8 BOM for Excel)
   */
  async exportAramexCSV(orderIds, user) {
    try {
      const orders = await this.fetchOrdersForExport(orderIds, user);
      const headers = ['Nom', 'Téléphone', 'Adresse', 'Gouvernorat', 'Produit', 'COD'];
      const rows = orders.map(order => {
        const row = ExportService.mapOrderToAramex(order);
        return headers.map(h => escapeCSVField(row[h])).join(',');
      });
      return '\uFEFF' + [headers.map(escapeCSVField).join(','), ...rows].join('\n');
    } catch (error) {
      logger.error('Error exporting Aramex CSV:', error);
      throw error;
    }
  }

  /**
   * Export selected orders in Aramex format as XLSX.
   * Sheet name: Aramex
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<Buffer>} XLSX buffer
   */
  async exportAramexXLSX(orderIds, user) {
    try {
      const orders = await this.fetchOrdersForExport(orderIds, user);
      const headers = ['Nom', 'Téléphone', 'Adresse', 'Gouvernorat', 'Produit', 'COD'];
      const data = [
        headers,
        ...orders.map(order => {
          const row = ExportService.mapOrderToAramex(order);
          return headers.map(h => row[h]);
        })
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      ExportService.autoSizeWorksheetColumns(ws, data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Aramex');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      logger.error('Error exporting Aramex XLSX:', error);
      throw error;
    }
  }
  // ─── RAPID POSTE EXPORT ────────────────────────────────────────────────────

  /**
   * Map a single order to a Rapid Poste row object.
   * Columns (in order): N° Commande, Destinataire, Téléphone,
   *                     Adresse Livraison, Code Postal, Gouvernorat, Montant COD
   *
   * Field mapping:
   *   N° Commande      → order.orderId
   *   Destinataire     → clientInfo.name
   *   Téléphone        → clientInfo.phone
   *   Adresse Livraison → buildAddress(clientInfo.address)
   *   Code Postal      → clientInfo.address.zipCode
   *   Gouvernorat      → clientInfo.address.state → order.region → clientInfo.address.city
   *   Montant COD      → totalAmount
   *
   * @param {Object} order
   * @returns {Object}
   */
  static mapOrderToRapidPoste(order) {
    const address = order.clientInfo?.address || {};
    const gouvernorat = address.state || order.region || address.city || '';
    return {
      'N° Commande':       order.orderId                           || '',
      'Destinataire':      order.clientInfo?.name                  || '',
      'Téléphone':         order.clientInfo?.phone                 || '',
      'Adresse Livraison': ExportService.buildAddress(address),
      'Code Postal':       address.zipCode                         || '',
      'Gouvernorat':       gouvernorat,
      'Montant COD':       order.totalAmount != null ? order.totalAmount : ''
    };
  }

  /**
   * Export selected orders in Rapid Poste format as CSV.
   * Headers: N° Commande,Destinataire,Téléphone,Adresse Livraison,Code Postal,Gouvernorat,Montant COD
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<string>} CSV string (UTF-8 BOM for Excel)
   */
  async exportRapidPosteCSV(orderIds, user) {
    try {
      const orders  = await this.fetchOrdersForExport(orderIds, user);
      const headers = [
        'N° Commande', 'Destinataire', 'Téléphone',
        'Adresse Livraison', 'Code Postal', 'Gouvernorat', 'Montant COD'
      ];
      const rows = orders.map(order => {
        const row = ExportService.mapOrderToRapidPoste(order);
        return headers.map(h => escapeCSVField(row[h])).join(',');
      });
      return '\uFEFF' + [headers.map(escapeCSVField).join(','), ...rows].join('\n');
    } catch (error) {
      logger.error('Error exporting Rapid Poste CSV:', error);
      throw error;
    }
  }

  /**
   * Export selected orders in Rapid Poste format as XLSX.
   * Sheet name: Rapid Poste
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<Buffer>} XLSX buffer
   */
  async exportRapidPosteXLSX(orderIds, user) {
    try {
      const orders  = await this.fetchOrdersForExport(orderIds, user);
      const headers = [
        'N° Commande', 'Destinataire', 'Téléphone',
        'Adresse Livraison', 'Code Postal', 'Gouvernorat', 'Montant COD'
      ];
      const data = [
        headers,
        ...orders.map(order => {
          const row = ExportService.mapOrderToRapidPoste(order);
          return headers.map(h => row[h]);
        })
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      ExportService.autoSizeWorksheetColumns(ws, data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rapid Poste');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      logger.error('Error exporting Rapid Poste XLSX:', error);
      throw error;
    }
  }

  // ─── YALIDINE EXPORT ───────────────────────────────────────────────────────

  /**
   * Map a single order to a Yalidine row object.
   * Columns (in order): Tracking, Nom, Téléphone, Adresse, Wilaya, Commune, Montant, Produit
   *
   * Field mapping:
   *   Tracking → order.deliveryInfo.trackingNumber → order.orderId
   *   Nom      → clientInfo.name
   *   Téléphone → clientInfo.phone
   *   Adresse  → buildAddress(clientInfo.address)
   *   Wilaya   → clientInfo.address.state → order.region
   *   Commune  → clientInfo.address.city
   *   Montant  → totalAmount
   *   Produit  → formatItems(items)
   *
   * Note: Order.js has no top-level trackingNumber field.
   * The only tracking field is deliveryInfo.trackingNumber.
   *
   * @param {Object} order
   * @returns {Object}
   */
  static mapOrderToYalidine(order) {
    const address  = order.clientInfo?.address || {};
    const tracking = order.deliveryInfo?.trackingNumber || order.orderId || '';
    const wilaya   = address.state || order.region || '';
    return {
      'Tracking':  tracking,
      'Nom':       order.clientInfo?.name  || '',
      'Téléphone': order.clientInfo?.phone || '',
      'Adresse':   ExportService.buildAddress(address),
      'Wilaya':    wilaya,
      'Commune':   address.city            || '',
      'Montant':   order.totalAmount != null ? order.totalAmount : '',
      'Produit':   ExportService.formatItems(order.items)
    };
  }

  /**
   * Export selected orders in Yalidine format as CSV.
   * Headers: Tracking,Nom,Téléphone,Adresse,Wilaya,Commune,Montant,Produit
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<string>} CSV string (UTF-8 BOM for Excel)
   */
  async exportYalidineCSV(orderIds, user) {
    try {
      const orders  = await this.fetchOrdersForExport(orderIds, user);
      const headers = ['Tracking', 'Nom', 'Téléphone', 'Adresse', 'Wilaya', 'Commune', 'Montant', 'Produit'];
      const rows = orders.map(order => {
        const row = ExportService.mapOrderToYalidine(order);
        return headers.map(h => escapeCSVField(row[h])).join(',');
      });
      return '\uFEFF' + [headers.map(escapeCSVField).join(','), ...rows].join('\n');
    } catch (error) {
      logger.error('Error exporting Yalidine CSV:', error);
      throw error;
    }
  }

  /**
   * Export selected orders in Yalidine format as XLSX.
   * Sheet name: Yalidine
   * @param {string[]} orderIds
   * @param {Object}   user
   * @returns {Promise<Buffer>} XLSX buffer
   */
  async exportYalidineXLSX(orderIds, user) {
    try {
      const orders  = await this.fetchOrdersForExport(orderIds, user);
      const headers = ['Tracking', 'Nom', 'Téléphone', 'Adresse', 'Wilaya', 'Commune', 'Montant', 'Produit'];
      const data = [
        headers,
        ...orders.map(order => {
          const row = ExportService.mapOrderToYalidine(order);
          return headers.map(h => row[h]);
        })
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      ExportService.autoSizeWorksheetColumns(ws, data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Yalidine');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      logger.error('Error exporting Yalidine XLSX:', error);
      throw error;
    }
  }

  // ─── CUSTOM EXPORT ─────────────────────────────────────────────────────────

  /**
   * Allowed column keys for custom export.
   * Maps key → French display label.
   */
  static get CUSTOM_COLUMN_LABELS() {
    return {
      customerName: 'Nom',
      phone:        'Téléphone',
      address:      'Adresse',
      region:       'Région',
      city:         'Ville',
      product:      'Produit',
      quantity:     'Quantité',
      amount:       'Montant',
      aiScore:      'Score IA',
      riskLevel:    'Niveau de risque',
      orderDate:    'Date de commande'
    };
  }

  /**
   * Validate the columns array for a custom export request.
   * Returns null on success, or an error message string on failure.
   * @param {*} columns
   * @returns {string|null}
   */
  static validateCustomColumns(columns) {
    if (!Array.isArray(columns)) {
      return 'columns must be an array';
    }
    if (columns.length === 0) {
      return 'columns must contain at least one column';
    }
    const allowed = Object.keys(ExportService.CUSTOM_COLUMN_LABELS);
    const invalid = columns.filter(c => !allowed.includes(c));
    if (invalid.length > 0) {
      return `Invalid column key(s): ${invalid.join(', ')}. Allowed: ${allowed.join(', ')}`;
    }
    const seen = new Set();
    for (const col of columns) {
      if (seen.has(col)) return `Duplicate column key: ${col}`;
      seen.add(col);
    }
    return null;
  }

  /**
   * Format order.createdAt as a readable date string: YYYY-MM-DD HH:MM
   * @param {Date|string} date
   * @returns {string}
   */
  static formatOrderDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Auto-size every column in a SheetJS worksheet based on the longest cell
   * value in each column (header included).
   *
   * Rules:
   *   - width = max cell length across all rows + 2 chars padding
   *   - minimum width: 12
   *   - maximum width: 40
   *
   * @param {Object}     ws   - SheetJS worksheet (mutated in-place)
   * @param {Array[]}    data - 2-D array used to build the worksheet (row 0 = headers)
   */
  static autoSizeWorksheetColumns(ws, data) {
    if (!data || data.length === 0) return;
    const colCount = data[0].length;
    const colWidths = [];
    for (let c = 0; c < colCount; c++) {
      let maxLen = 0;
      for (const row of data) {
        const cell = row[c];
        const len  = cell != null ? String(cell).length : 0;
        if (len > maxLen) maxLen = len;
      }
      const width = Math.min(40, Math.max(12, maxLen + 2));
      colWidths.push({ wch: width });
    }
    ws['!cols'] = colWidths;
  }

  /**
   * Map a single order to a custom row object using the requested columns.
   * Returns an object keyed by French display label (for CSV/XLSX headers).
   *
   * Field mapping:
   *   customerName → clientInfo.name
   *   phone        → clientInfo.phone
   *   address      → buildAddress(clientInfo.address)
   *   region       → clientInfo.address.state → order.region
   *   city         → clientInfo.address.city
   *   product      → formatItems(items)
   *   quantity     → sum of item.quantity across items[]
   *   amount       → totalAmount
   *   aiScore      → order.aiScore (Pro field, may be undefined → '—')
   *   riskLevel    → order.riskLevel (Pro field, may be undefined → 'Non analysé')
   *   orderDate    → createdAt formatted as YYYY-MM-DD HH:MM
   *
   * @param {Object}   order
   * @param {string[]} columns - ordered list of column keys
   * @returns {Object} keyed by French label
   */
  static mapOrderToCustom(order, columns) {
    const address   = order.clientInfo?.address || {};
    const labels    = ExportService.CUSTOM_COLUMN_LABELS;
    const totalQty  = Array.isArray(order.items)
      ? order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)
      : 0;

    const valueMap = {
      customerName: order.clientInfo?.name                          || '',
      phone:        order.clientInfo?.phone                         || '',
      address:      ExportService.buildAddress(address),
      region:       address.state                                   || order.region || '',
      city:         address.city                                    || '',
      product:      ExportService.formatItems(order.items),
      quantity:     totalQty,
      amount:       order.totalAmount != null ? order.totalAmount   : '',
      aiScore:      order.aiScore     != null ? order.aiScore       : '\u2014',
      riskLevel:    order.riskLevel                                 || 'Non analys\u00E9',
      orderDate:    ExportService.formatOrderDate(order.createdAt)
    };

    // Build result keyed by French label in the requested column order
    const result = {};
    for (const col of columns) {
      result[labels[col]] = valueMap[col];
    }
    return result;
  }

  /**
   * Export selected orders in Custom format as CSV.
   * Column order matches the `columns` array exactly.
   * Headers use French display labels.
   * @param {string[]} orderIds
   * @param {Object}   user
   * @param {string[]} columns - ordered column keys
   * @returns {Promise<string>} CSV string (UTF-8 BOM for Excel)
   */
  async exportCustomCSV(orderIds, user, columns) {
    try {
      const orders  = await this.fetchOrdersForExport(orderIds, user);
      const labels  = ExportService.CUSTOM_COLUMN_LABELS;
      const headers = columns.map(col => labels[col]);
      const rows = orders.map(order => {
        const row = ExportService.mapOrderToCustom(order, columns);
        return headers.map(h => escapeCSVField(row[h])).join(',');
      });
      return '\uFEFF' + [headers.map(escapeCSVField).join(','), ...rows].join('\n');
    } catch (error) {
      logger.error('Error exporting Custom CSV:', error);
      throw error;
    }
  }

  /**
   * Export selected orders in Custom format as XLSX.
   * Sheet name: Custom
   * @param {string[]} orderIds
   * @param {Object}   user
   * @param {string[]} columns - ordered column keys
   * @returns {Promise<Buffer>} XLSX buffer
   */
  async exportCustomXLSX(orderIds, user, columns) {
    try {
      const orders  = await this.fetchOrdersForExport(orderIds, user);
      const labels  = ExportService.CUSTOM_COLUMN_LABELS;
      const headers = columns.map(col => labels[col]);
      const data = [
        headers,
        ...orders.map(order => {
          const row = ExportService.mapOrderToCustom(order, columns);
          return headers.map(h => row[h]);
        })
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      ExportService.autoSizeWorksheetColumns(ws, data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Custom');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      logger.error('Error exporting Custom XLSX:', error);
      throw error;
    }
  }
}

module.exports = new ExportService();
module.exports.ExportService = ExportService;