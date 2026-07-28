const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Column alias mappings for AI column detection.
 * Maps common column names from various e-commerce platforms to CONFIRMED standard fields.
 * Supports: Converty, Tiktak Pro, Shopify, WooCommerce, PrestaShop, custom Excel files.
 *
 * RULES:
 * - Exact aliases: full header must match exactly (after normalization)
 * - Fuzzy matching is done separately with exclusion guards
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
    // Exact matches only — ambiguous words like "price" are handled in fuzzy with guards
    'montant', 'total', 'order total', 'total price', 'total commande',
    'montant total', 'valeur commande', 'prix total', 'order amount',
    'total_amount', 'montant_total', 'prix commande', 'subtotal',
    'prix', 'price', 'amount', 'valeur', 'sum'
  ],
  deliveryCost: [
    // Separate field so delivery price is NEVER confused with order total
    'delivery price', 'frais livraison', 'shipping cost', 'frais de livraison',
    'delivery cost', 'shipping price', 'shipping fee', 'delivery fee',
    'cout livraison', 'coût livraison', 'prix livraison'
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
 * Words that indicate a column is NOT the order total amount.
 * Used to block fuzzy matching of totalAmount when these words appear in the header.
 */
const TOTAL_AMOUNT_BLOCKLIST = [
  'delivery', 'livraison', 'shipping', 'frais', 'fee', 'cost',
  'tax', 'taxe', 'tva', 'discount', 'remise', 'reduction',
  'tip', 'surcharge', 'handling'
];

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
 * Priority: exact match → fuzzy match (with guards for ambiguous fields).
 * Returns the field key or null if no match.
 * @param {string} rawHeader
 * @returns {string|null}
 */
function detectColumnField(rawHeader) {
  const normalized = normalizeHeader(rawHeader);

  // 1. Exact match — highest priority, no guards needed
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (normalizeHeader(alias) === normalized) {
        return field;
      }
    }
  }

  // 2. Fuzzy / partial match — with field-specific guards
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    // Guard: never fuzzy-match totalAmount when header contains delivery/shipping words
    if (field === 'totalAmount') {
      const isDeliveryRelated = TOTAL_AMOUNT_BLOCKLIST.some(word => normalized.includes(word));
      if (isDeliveryRelated) continue;
    }

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
 * Detect column mappings with confidence scores for all headers.
 *
 * Returns:
 *  - columnMapping:   { confirmedField: rawHeader }  — backward-compat simple map
 *  - mappingDetails:  array of { rawHeader, confirmedField|null, confidence 0-100, allScores }
 *  - unmappedHeaders: headers that scored below the threshold for every field
 *
 * Algorithm:
 *  Pass 1 — score every header against every field.
 *  Pass 2 — assign fields greedily by highest score, one field per header.
 *  Confidence = score / 100 clamped, plus a small bonus for being unambiguous.
 *
 * @param {string[]} headers
 * @returns {{ columnMapping, mappingDetails, unmappedHeaders }}
 */
function detectColumnMappingWithScores(headers) {
  const MIN_SCORE = 40; // below this → unmapped

  // Step 1: compute raw score for every (header, field) pair
  // scores[headerIdx][field] = 0–100
  const rawScores = headers.map(header => {
    const normalized = normalizeHeader(header);
    const fieldScores = {};
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      let best = 0;

      // Exact match → 100
      for (const alias of aliases) {
        if (normalizeHeader(alias) === normalized) { best = 100; break; }
      }

      if (best < 100) {
        // Fuzzy — blocked for totalAmount if header contains delivery words
        if (field === 'totalAmount') {
          const blocked = TOTAL_AMOUNT_BLOCKLIST.some(w => normalized.includes(normalizeHeader(w)));
          if (blocked) { fieldScores[field] = 0; continue; }
        }

        for (const alias of aliases) {
          const normAlias = normalizeHeader(alias);
          if (normalized.includes(normAlias) || normAlias.includes(normalized)) {
            // Score based on how specific the match is
            // Prefer longer alias matches (more tokens = more specific)
            const aliasTokens = normAlias.split(/\s+/).length;
            const headerTokens = normalized.split(/\s+/).length;
            const specificity = Math.min(aliasTokens, headerTokens);
            const score = 40 + Math.min(specificity * 10, 40); // 40–80
            if (score > best) best = score;
          }
        }
      }

      fieldScores[field] = best;
    }
    return fieldScores;
  });

  // Step 2: greedy assignment — process fields in priority order
  // Each header can only claim one field; each field can only be claimed once
  const FIELD_PRIORITY = [
    'deliveryCost', 'orderId', 'clientPhone', 'clientName',
    'totalAmount', 'productName', 'quantity',
    'region', 'city', 'address', 'notes'
  ];

  const claimedHeaders = new Set();  // headerIdx
  const claimedFields  = new Set();  // field

  // fieldWinner[field] = { headerIdx, score }
  const fieldWinner = {};

  for (const field of FIELD_PRIORITY) {
    let bestIdx = -1, bestScore = 0;
    headers.forEach((_, idx) => {
      if (claimedHeaders.has(idx)) return;
      const score = rawScores[idx][field] ?? 0;
      if (score > bestScore && score >= MIN_SCORE) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      fieldWinner[field] = { headerIdx: bestIdx, score: bestScore };
      claimedHeaders.add(bestIdx);
      claimedFields.add(field);
    }
  }

  // Step 3: build output structures
  const columnMapping = {};
  const mappingDetails = headers.map((rawHeader, idx) => {
    // Find if this header was assigned to a field
    const assignedField = Object.entries(fieldWinner).find(
      ([, v]) => v.headerIdx === idx
    )?.[0] ?? null;

    const score = assignedField ? fieldWinner[assignedField].score : 0;

    // Confidence: normalize score to 0–100, penalise fuzzy matches slightly
    let confidence = score;
    if (score > 0 && score < 100) {
      // Reduce confidence for partial matches — exact=100, fuzzy=40–80
      confidence = Math.round(score * 0.9); // mild penalty, keeps it honest
    }

    // Build allScores map for extensibility / debugging
    const allScores = {};
    for (const field of FIELD_PRIORITY) {
      const s = rawScores[idx][field] ?? 0;
      if (s > 0) allScores[field] = s;
    }

    if (assignedField) {
      columnMapping[assignedField] = rawHeader;
    }

    return {
      rawHeader,
      confirmedField: assignedField,
      confidence,     // 0-100
      allScores,      // { field: score } for all non-zero fields
    };
  });

  const unmappedHeaders = mappingDetails
    .filter(d => d.confirmedField === null)
    .map(d => d.rawHeader);

  return { columnMapping, mappingDetails, unmappedHeaders };
}

/**
 * Detect column mappings (simple version, backward-compat).
 * @param {string[]} headers
 * @returns {object} { confirmedField: rawHeader }
 */
function detectColumnMapping(headers) {
  return detectColumnMappingWithScores(headers).columnMapping;
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
 * Rule: the ONLY hard requirement is a valid phone number.
 *       Everything else (name, address, amount) generates a warning at most.
 * Returns a status: 'valid', 'warning', or 'rejected', plus messages.
 * @param {object} row - Mapped row with CONFIRMED field names as keys
 * @param {number} index
 * @returns {{ status: string, warnings: string[], errors: string[] }}
 */
function validateRow(row, index) {
  const errors = [];
  const warnings = [];

  // ── Only hard requirement: phone number ────────────────────────────────────
  const phoneValidation = validatePhone(row.clientPhone);
  if (!phoneValidation.valid) {
    errors.push(phoneValidation.message || 'Numéro de téléphone invalide');
  }

  // ── Soft warnings (do not reject) ─────────────────────────────────────────
  if (!row.clientName || row.clientName.trim().length < 2) {
    warnings.push('Nom client manquant ou incomplet');
  }

  if (!row.address || row.address.trim() === '') {
    warnings.push('Adresse vide');
  }

  if (row.totalAmount) {
    const amount = parseFloat(row.totalAmount);
    if (isNaN(amount) || amount < 0) {
      warnings.push('Montant invalide');
    }
  }

  // ── Result ─────────────────────────────────────────────────────────────────
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
  const { columnMapping, mappingDetails, unmappedHeaders } = detectColumnMappingWithScores(headers);
  
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
      mappingDetails,
      unmappedHeaders,
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
    mappingDetails,
    unmappedHeaders,
    insights,
    previewRows,
    importedOrderIds: importedOrders
  };
}

module.exports = {
  parseFileBuffer,
  detectColumnMapping,
  detectColumnMappingWithScores,
  detectColumnField,
  validateRow,
  generateInsights,
  processImport,
  rowToOrderPayload,
  COLUMN_ALIASES
};
