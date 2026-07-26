const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Column alias mappings for AI column detection.
 * Maps common column names from various e-commerce platforms to CONFIRMED standard fields.
 * Supports: Converty, Tiktak Pro, Shopify, WooCommerce, PrestaShop, custom Excel files.
 */
const COLUMN_ALIASES = {
  clientName: [
    'nom client', 'nom', 'customer name', 'full name', 'name', 'client',
    'prénom nom', 'prenom nom', 'customer', 'billing name', 'ship to name',
    'contact name', 'nom complet', 'fullname', 'nom_client', 'customer_name',
    'nom du client', 'destinataire'
  ],
  clientPhone: [
    'téléphone', 'telephone', 'tel', 'phone', 'mobile', 'phone number',
    'numéro', 'numero', 'contact', 'gsm', 'portable', 'num', 'phone_number',
    'billing phone', 'shipping phone', 'mobile phone', 'numéro de téléphone',
    'num_tel', 'tel_client', 'phone1', 'contact_phone'
  ],
  region: [
    'gouvernorat', 'gouvernement', 'region', 'state', 'ville principale',
    'wilaya', 'province', 'city_state', 'état', 'etat', 'shipping state',
    'billing state', 'zone', 'secteur'
  ],
  city: [
    'ville', 'city', 'localité', 'localite', 'commune', 'municipality',
    'shipping city', 'billing city', 'cité', 'cite', 'town'
  ],
  address: [
    'adresse', 'address', 'shipping address', 'delivery address',
    'adresse livraison', 'adresse de livraison', 'street', 'rue',
    'billing address', 'adresse_livraison', 'adresse complète', 'adresse complete'
  ],
  totalAmount: [
    'montant', 'total', 'prix', 'price', 'order total', 'total price',
    'amount', 'valeur', 'valeur commande', 'total commande', 'prix total',
    'order amount', 'price total', 'sum', 'total_amount', 'montant_total',
    'prix commande', 'subtotal'
  ],
  productName: [
    'produit', 'product', 'article', 'item', 'product name', 'item name',
    'nom produit', 'désignation', 'designation', 'libellé', 'libelle',
    'product_name', 'nom_produit', 'articles', 'products', 'description produit'
  ],
  quantity: [
    'quantité', 'quantite', 'qty', 'quantity', 'qte', 'nb', 'nombre',
    'count', 'units', 'qté', 'unit', 'qty_ordered', 'quantite_commandee'
  ],
  orderId: [
    'id commande', 'order id', 'order number', 'num commande', 'numéro commande',
    'numero commande', 'reference', 'ref', 'id', 'order_id', 'ref_commande',
    'order_number', 'no commande', 'number'
  ],
  notes: [
    'notes', 'remarques', 'commentaires', 'comments', 'note', 'observation',
    'instructions', 'delivery notes', 'notes livraison', 'remarque'
  ]
};

/**
 * Normalize a header string for comparison: lowercase, remove accents and special chars.
 * @param {string} header
 * @returns {string}
 */
function normalizeHeader(header) {
  return String(header || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9\s_]/g, '')
    .trim();
}

/**
 * Detect which CONFIRMED field a raw column header maps to.
 * Returns the field key or null if no match.
 * @param {string} rawHeader
 * @returns {string|null}
 */
function detectColumnField(rawHeader) {
  const normalized = normalizeHeader(rawHeader);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (normalizeHeader(alias) === normalized) {
        return field;
      }
    }
  }
  // Fuzzy: partial match
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const normAlias = normalizeHeader(alias);
      if (normalized.includes(normAlias) || normAlias.includes(normalized)) {
        return field;
      }
    }
  }
  return null;
}

/**
 * Parse a file buffer (xlsx or csv) and return raw rows as objects.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {{ headers: string[], rows: object[] }}
 */
function parseFileBuffer(buffer, mimetype) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Convert to array of arrays to get raw headers
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  if (!rawData || rawData.length < 2) {
    return { headers: [], rows: [] };
  }
  
  const headers = rawData[0].map(h => String(h || '').trim());
  const rows = rawData.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? String(row[i]).trim() : '';
      });
      return obj;
    });
  
  return { headers, rows };
}

/**
 * AI Column Detection - maps file headers to CONFIRMED standard fields.
 * @param {string[]} headers
 * @returns {object} mapping: { confirmedField: rawHeader }
 */
function detectColumnMapping(headers) {
  const mapping = {};
  const usedHeaders = new Set();
  
  for (const header of headers) {
    const field = detectColumnField(header);
    if (field && !mapping[field]) {
      mapping[field] = header;
      usedHeaders.add(header);
    }
  }
  
  return mapping;
}

/**
 * Validate a single phone number (basic validation).
 * @param {string} phone
 * @returns {{ valid: boolean, message?: string }}
 */
function validatePhone(phone) {
  if (!phone || phone.trim() === '') {
    return { valid: false, message: 'Numéro de téléphone manquant' };
  }
  const cleaned = phone.replace(/[\s\-\(\)\+\.]/g, '');
  if (cleaned.length < 8) {
    return { valid: false, message: 'Numéro trop court' };
  }
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, message: 'Numéro invalide (caractères non numériques)' };
  }
  return { valid: true };
}

/**
 * Validate a single row of data against CONFIRMED fields.
 * Returns a status: 'valid', 'warning', or 'rejected', plus error messages.
 * @param {object} row - Mapped row with CONFIRMED field names as keys
 * @param {number} index
 * @returns {{ status: string, warnings: string[], errors: string[] }}
 */
function validateRow(row, index) {
  const errors = [];
  const warnings = [];
  
  // Required: clientName
  if (!row.clientName || row.clientName.trim() === '') {
    errors.push('Nom client manquant');
  } else if (row.clientName.trim().split(' ').length < 1 || row.clientName.trim().length < 2) {
    warnings.push('Nom incomplet');
  }
  
  // Required: clientPhone
  const phoneValidation = validatePhone(row.clientPhone);
  if (!phoneValidation.valid) {
    errors.push(phoneValidation.message || 'Numéro de téléphone invalide');
  }
  
  // Warning: address empty
  if (!row.address || row.address.trim() === '') {
    warnings.push('Adresse vide');
  }
  
  // Warning: amount suspicious
  if (row.totalAmount) {
    const amount = parseFloat(row.totalAmount);
    if (isNaN(amount) || amount <= 0) {
      errors.push('Montant invalide');
    }
  }
  
  if (errors.length > 0) {
    return { status: 'rejected', warnings, errors };
  }
  if (warnings.length > 0) {
    return { status: 'warning', warnings, errors };
  }
  return { status: 'valid', warnings, errors };
}

/**
 * Apply column mapping to a raw row to produce a CONFIRMED-field row.
 * @param {object} rawRow
 * @param {object} mapping - { confirmedField: rawHeader }
 * @returns {object}
 */
function applyMapping(rawRow, mapping) {
  const mapped = {};
  for (const [field, header] of Object.entries(mapping)) {
    mapped[field] = rawRow[header] || '';
  }
  return mapped;
}

/**
 * Detect duplicates in the batch and against the DB.
 * @param {object[]} mappedRows
 * @param {object} Order - Mongoose model
 * @param {string} shopId
 * @returns {Promise<Map<number, string>>} map of row index → duplicate reason
 */
async function detectDuplicates(mappedRows, Order, shopId) {
  const duplicates = new Map();
  const phones = mappedRows
    .map((r, i) => ({ phone: (r.clientPhone || '').replace(/[\s\-\(\)\+\.]/g, ''), index: i }))
    .filter(r => r.phone);
  
  // Check in-batch duplicates first
  const seenPhones = new Map();
  for (const { phone, index } of phones) {
    if (seenPhones.has(phone)) {
      duplicates.set(index, 'Doublon dans le fichier (même téléphone)');
    } else {
      seenPhones.set(phone, index);
    }
  }
  
  // Check against DB
  const phonesToCheck = phones
    .filter(r => !duplicates.has(r.index))
    .map(r => r.phone);
  
  if (phonesToCheck.length > 0) {
    try {
      // Build regex patterns to match normalized phones
      const existingOrders = await Order.find({
        shopId,
        'clientInfo.phone': {
          $in: phonesToCheck.map(p => new RegExp(p.split('').join('[\\s\\-\\.]*')))
        }
      }).select('clientInfo.phone').lean();
      
      const existingPhones = new Set(
        existingOrders.map(o =>
          (o.clientInfo?.phone || '').replace(/[\s\-\(\)\+\.]/g, '')
        )
      );
      
      for (const { phone, index } of phones) {
        if (!duplicates.has(index) && existingPhones.has(phone)) {
          duplicates.set(index, 'Téléphone déjà existant en base');
        }
      }
    } catch (err) {
      logger.warn('Duplicate DB check failed:', err);
    }
  }
  
  return duplicates;
}

/**
 * Generate AI insights from the validated data.
 * @param {object[]} mappedRows
 * @param {object[]} validationResults
 * @param {Map} duplicateMap
 * @returns {string[]}
 */
function generateInsights(mappedRows, validationResults, duplicateMap) {
  const insights = [];
  const total = mappedRows.length;
  if (total === 0) return insights;
  
  const incompleteCount = validationResults.filter(r => r.status === 'warning').length;
  const rejectedCount = validationResults.filter(r => r.status === 'rejected').length;
  const duplicateCount = duplicateMap.size;
  
  if (incompleteCount > 0) {
    const pct = Math.round((incompleteCount / total) * 100);
    insights.push(`${pct}% des commandes présentent des données incomplètes`);
  }
  
  // Phone number issues
  const phoneIssues = validationResults.filter(r =>
    r.errors.some(e => e.toLowerCase().includes('téléphone') || e.toLowerCase().includes('numéro'))
  ).length;
  if (phoneIssues > 0) {
    const pct = Math.round((phoneIssues / total) * 100);
    insights.push(`${pct}% des numéros semblent invalides`);
  }
  
  if (duplicateCount > 0) {
    insights.push(`${duplicateCount} commande(s) sont des doublons potentiels`);
  }
  
  if (rejectedCount > 0) {
    insights.push(`${rejectedCount} commande(s) seront rejetées faute de données requises`);
  }
  
  // Amount outliers
  const amounts = mappedRows
    .map(r => parseFloat(r.totalAmount))
    .filter(a => !isNaN(a) && a > 0);
  if (amounts.length > 2) {
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const outliers = amounts.filter(a => a > avg * 2).length;
    if (outliers > 0) {
      insights.push(`${outliers} commande(s) dépassent le montant moyen habituel (${avg.toFixed(0)} TND)`);
    }
  }
  
  return insights;
}

/**
 * Convert a mapped row to an Order document payload.
 * @param {object} row
 * @param {string} shopId
 * @returns {object}
 */
function rowToOrderPayload(row, shopId) {
  const amount = parseFloat(row.totalAmount) || 0;
  const quantity = parseInt(row.quantity, 10) || 1;
  const price = amount / quantity || amount;
  
  return {
    orderId: row.orderId || `IMP-${uuidv4().slice(0, 8).toUpperCase()}`,
    shopId,
    clientInfo: {
      name: row.clientName || 'Inconnu',
      phone: row.clientPhone || '',
      address: {
        street: row.address || '',
        city: row.city || '',
        state: row.region || '',
        zipCode: '',
        country: 'TN'
      }
    },
    items: [{
      name: row.productName || 'Produit importé',
      quantity,
      price,
      sku: ''
    }],
    totalAmount: amount,
    status: 'pending',
    priority: 'medium'
  };
}

/**
 * Main import processing function.
 * @param {Buffer} fileBuffer
 * @param {string} mimetype
 * @param {object} options
 * @param {string} options.shopId
 * @param {string} options.userId
 * @param {string} options.fileName
 * @param {string} options.duplicateAction - 'ignore'|'import'|'merge'
 * @param {boolean} options.dryRun - if true, don't actually save
 * @param {object} options.Order - Mongoose Order model
 * @param {object} options.ImportHistory - Mongoose ImportHistory model
 * @returns {Promise<object>}
 */
async function processImport(fileBuffer, mimetype, options = {}) {
  const {
    shopId,
    userId,
    fileName,
    duplicateAction = 'ignore',
    dryRun = false,
    Order,
    ImportHistory
  } = options;
  
  // 1. Parse file
  const { headers, rows } = parseFileBuffer(fileBuffer, mimetype);
  
  if (rows.length === 0) {
    return {
      success: false,
      error: 'Fichier vide ou format non reconnu',
      totalDetected: 0
    };
  }
  
  // 2. AI column detection
  const columnMapping = detectColumnMapping(headers);
  
  // 3. Map all rows to CONFIRMED fields
  const mappedRows = rows.map(r => applyMapping(r, columnMapping));
  
  // 4. Validate rows
  const validationResults = mappedRows.map((row, i) => validateRow(row, i));
  
  // 5. Detect duplicates
  const duplicateMap = await detectDuplicates(mappedRows, Order, shopId);
  
  // 6. Generate AI insights
  const insights = generateInsights(mappedRows, validationResults, duplicateMap);
  
  // 7. Build preview rows with statuses
  const previewRows = mappedRows.map((row, i) => {
    const validation = validationResults[i];
    const isDuplicate = duplicateMap.has(i);
    
    let finalStatus = validation.status;
    if (isDuplicate) {
      if (duplicateAction === 'ignore') {
        finalStatus = 'duplicate_ignored';
      } else if (duplicateAction === 'import') {
        // keep existing validation status, will be imported
      }
    }
    
    return {
      rowIndex: i,
      clientName: row.clientName || '',
      clientPhone: row.clientPhone || '',
      productName: row.productName || '',
      region: row.region || row.city || '',
      totalAmount: row.totalAmount || '',
      address: row.address || '',
      status: finalStatus,
      isDuplicate,
      duplicateReason: isDuplicate ? duplicateMap.get(i) : null,
      warnings: validation.warnings,
      errors: validation.errors
    };
  });
  
  // Summary counts
  const validCount = previewRows.filter(r => r.status === 'valid').length;
  const warningCount = previewRows.filter(r => r.status === 'warning').length;
  const rejectedCount = previewRows.filter(r => r.status === 'rejected').length;
  const duplicateCount = previewRows.filter(r => r.status === 'duplicate_ignored').length;
  
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      fileName,
      totalDetected: rows.length,
      totalValid: validCount + warningCount,
      totalRejected: rejectedCount,
      totalDuplicates: duplicateCount,
      columnMapping,
      headers,
      insights,
      previewRows
    };
  }
  
  // 8. Import valid orders
  const importedOrders = [];
  const importErrors = [];
  
  for (const preview of previewRows) {
    if (preview.status === 'duplicate_ignored' || preview.status === 'rejected') {
      continue;
    }
    
    try {
      const payload = rowToOrderPayload(mappedRows[preview.rowIndex], shopId);
      const order = new Order(payload);
      await order.save();
      importedOrders.push(order._id);
    } catch (err) {
      logger.warn(`Failed to import row ${preview.rowIndex}:`, err.message);
      importErrors.push({ row: preview.rowIndex, message: err.message });
    }
  }
  
  // 9. Save import history
  try {
    await ImportHistory.create({
      shopId,
      userId,
      fileName,
      fileType: fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx',
      totalDetected: rows.length,
      totalImported: importedOrders.length,
      totalRejected: rejectedCount + importErrors.length,
      totalDuplicates: duplicateCount,
      errorsDetected: rejectedCount,
      status: 'completed',
      errorDetails: importErrors.map(e => ({
        row: e.row,
        field: 'general',
        message: e.message
      }))
    });
  } catch (histErr) {
    logger.warn('Failed to save import history:', histErr.message);
  }
  
  return {
    success: true,
    fileName,
    totalDetected: rows.length,
    totalImported: importedOrders.length,
    totalRejected: rejectedCount,
    totalDuplicates: duplicateCount,
    errorsDetected: rejectedCount,
    columnMapping,
    insights,
    previewRows,
    importedOrderIds: importedOrders
  };
}

module.exports = {
  parseFileBuffer,
  detectColumnMapping,
  detectColumnField,
  validateRow,
  generateInsights,
  processImport,
  rowToOrderPayload,
  COLUMN_ALIASES
};
