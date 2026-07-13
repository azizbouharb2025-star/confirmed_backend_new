const Complaint = require('../models/Complaint');
const Order = require('../models/Order');
const SupportCardToken = require('../models/SupportCardToken');
const supportCardService = require('./supportCardService');
const complaintAIService = require('./complaintAIService');
const { emitComplaintNew, emitComplaintUpdate, emitComplaintCreated } = require('../websocket/complaintEvents');
const logger = require('../utils/logger');

/**
 * Complaint Service
 * Core business logic for complaint management
 */
class ComplaintService {
  /**
   * Generate a unique reference number for a complaint
   * Format: CMP-YYYYMMDD-XXXX (4 random alphanumeric chars)
   * **Validates: Requirements 2.6**
   * 
   * @returns {Promise<string>} Unique reference number
   * @private
   */
  async _generateReferenceNumber() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const maxRetries = 10;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Get current date in YYYYMMDD format
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateStr = `${year}${month}${day}`;
      
      // Generate 4 random alphanumeric characters
      let randomPart = '';
      for (let i = 0; i < 4; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      const referenceNumber = `CMP-${dateStr}-${randomPart}`;
      
      // Check if reference number already exists
      const existing = await Complaint.findOne({ referenceNumber });
      if (!existing) {
        return referenceNumber;
      }
      
      logger.warn(`Reference number collision: ${referenceNumber}, retrying...`);
    }
    
    // If all retries fail, throw an error
    const error = new Error('Failed to generate unique reference number');
    error.statusCode = 500;
    error.code = 'REFERENCE_GENERATION_FAILED';
    throw error;
  }

  /**
   * Apply AI tagging to a complaint (non-blocking)
   * Updates complaint with aiTags, aiPrimaryCategory, or requiresManualReview flag
   * **Validates: Requirements 5.1, 5.4**
   * 
   * @param {string} complaintId - Complaint ID
   * @param {string} description - Complaint description
   * @returns {Promise<void>}
   * @private
   */
  async _applyAITagging(complaintId, description) {
    try {
      const result = await complaintAIService.analyzeComplaint(description);

      const complaint = await Complaint.findById(complaintId);
      if (!complaint) {
        logger.warn('Complaint not found for AI tagging', { complaintId });
        return;
      }

      if (result.success) {
        // Update complaint with AI tags and primary category (Requirement 5.1, 5.2, 5.3)
        complaint.aiTags = result.tags;
        complaint.aiPrimaryCategory = result.primaryCategory;
        complaint.requiresManualReview = false;
      } else {
        // Handle failure gracefully - set requiresManualReview=true (Requirement 5.4)
        complaint.requiresManualReview = true;
      }

      await complaint.save();

      logger.info('AI tagging applied to complaint', {
        complaintId,
        success: result.success,
        primaryCategory: result.primaryCategory,
        requiresManualReview: complaint.requiresManualReview
      });
    } catch (error) {
      // Handle any unexpected errors gracefully (Requirement 5.4)
      logger.error('Error applying AI tagging:', {
        complaintId,
        error: error.message
      });

      try {
        await Complaint.findByIdAndUpdate(complaintId, {
          requiresManualReview: true
        });
      } catch (updateError) {
        logger.error('Failed to set requiresManualReview flag:', {
          complaintId,
          error: updateError.message
        });
      }
    }
  }

  /**
   * Create a new complaint
   * Validates token, generates reference number, copies customer info from order
   * **Validates: Requirements 2.5, 2.6**
   * 
   * @param {Object} data - Complaint data (category, description, mediaAttachments)
   * @param {string} supportCardToken - Support card token string
   * @returns {Promise<Object>} Created complaint
   */
  async createComplaint(data, supportCardToken) {
    // Validate the support card token
    const tokenValidation = await supportCardService.validateToken(supportCardToken);
    
    if (!tokenValidation.valid) {
      const error = new Error(tokenValidation.error);
      error.statusCode = tokenValidation.code === 'TOKEN_EXPIRED' ? 410 : 400;
      error.code = tokenValidation.code;
      throw error;
    }

    const { order, tokenId, shopId } = tokenValidation;

    // Generate unique reference number
    const referenceNumber = await this._generateReferenceNumber();

    // Extract product IDs from order items
    const productIds = order.items
      .filter(item => item.productId)
      .map(item => item.productId._id || item.productId);

    // Create complaint with customer info copied from order
    const complaint = new Complaint({
      referenceNumber,
      orderId: order._id,
      shopId,
      supportCardTokenId: tokenId,
      customerInfo: {
        name: order.clientInfo.name,
        phone: order.clientInfo.phone,
        email: order.clientInfo.email
      },
      category: data.category,
      description: data.description,
      mediaAttachments: data.mediaAttachments || [],
      status: 'open',
      region: order.region,
      productIds,
      resolutionHistory: [{
        status: 'open',
        note: 'Complaint submitted',
        timestamp: new Date()
      }]
    });

    await complaint.save();

    // Mark the support card token as used
    await supportCardService.markTokenUsed(supportCardToken);

    logger.info(`Complaint created: ${referenceNumber}`, {
      complaintId: complaint._id,
      orderId: order._id,
      shopId,
      category: data.category
    });

    // Emit WebSocket notification for new complaint
    // **Validates: Requirements 8.1**
    emitComplaintNew(complaint);
    
    // Emit complaint created event with order association
    emitComplaintCreated(complaint, data.orderId);

    // Call AI tagging after complaint creation (non-blocking)
    // **Validates: Requirements 5.1, 5.4**
    this._applyAITagging(complaint._id, data.description).catch(err => {
      logger.error('Non-blocking AI tagging failed:', { 
        complaintId: complaint._id, 
        error: err.message 
      });
    });

    return complaint;
  }

  /**
   * Find complaints with pagination, filtering, and search
   * Enforces shop isolation for non-admin users
   * **Validates: Requirements 3.1, 3.2, 3.3, 7.3**
   * 
   * @param {Object} filters - Filter parameters
   * @param {string} [filters.status] - Filter by status
   * @param {string} [filters.category] - Filter by category
   * @param {string} [filters.startDate] - Filter by date range start
   * @param {string} [filters.endDate] - Filter by date range end
   * @param {string} [filters.productId] - Filter by product ID
   * @param {string} [filters.region] - Filter by region
   * @param {string} [filters.search] - Search across referenceNumber, customerInfo.name, description
   * @param {number} [filters.page=1] - Page number
   * @param {number} [filters.limit=20] - Items per page
   * @param {Object} user - Current user
   * @returns {Promise<Object>} { complaints, total, page, limit, totalPages }
   */
  async findComplaints(filters = {}, user = {}) {
    const {
      status,
      category,
      startDate,
      endDate,
      productId,
      region,
      search,
      page = 1,
      limit = 20
    } = filters;

    // Build query
    const query = {};

    // Shop isolation: non-admin users can only see their own shop's complaints
    // Ignore shopId parameter for non-admin users (Requirement 7.3)
    if (user.role === 'admin' && filters.shopId) {
      query.shopId = filters.shopId;
    } else if (user.shopId) {
      query.shopId = user.shopId;
    }

    // Apply filters
    if (status) {
      query.status = status;
    }

    if (category) {
      query.category = category;
    }

    if (region) {
      query.region = region;
    }

    if (productId) {
      query.productIds = productId;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Search across referenceNumber, customerInfo.name, description
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { referenceNumber: searchRegex },
        { 'customerInfo.name': searchRegex },
        { description: searchRegex }
      ];
    }

    // Calculate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Execute query with pagination
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('shopId', 'name domain')
        .populate('orderId', 'orderId clientInfo totalAmount status')
        .lean(),
      Complaint.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limitNum);

    logger.info('Complaints fetched', {
      shopId: query.shopId,
      filters: { status, category, region, productId, search },
      total,
      page: pageNum,
      limit: limitNum
    });

    return {
      complaints,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages
    };
  }

  /**
   * Get dashboard summary with counts grouped by status and category
   * **Validates: Requirements 3.5**
   * 
   * @param {string} shopId - Shop ID to get summary for
   * @returns {Promise<Object>} { byStatus, byCategory }
   */
  async getDashboardSummary(shopId) {
    const [byStatus, byCategory] = await Promise.all([
      // Aggregate by status
      Complaint.aggregate([
        { $match: { shopId: new (require('mongoose').Types.ObjectId)(shopId) } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      // Aggregate by category
      Complaint.aggregate([
        { $match: { shopId: new (require('mongoose').Types.ObjectId)(shopId) } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ])
    ]);

    // Transform aggregation results into objects
    const statusCounts = {};
    byStatus.forEach(item => {
      statusCounts[item._id] = item.count;
    });

    const categoryCounts = {};
    byCategory.forEach(item => {
      categoryCounts[item._id] = item.count;
    });

    logger.info('Dashboard summary fetched', { shopId });

    return {
      byStatus: statusCounts,
      byCategory: categoryCounts
    };
  }

  /**
   * Find a complaint by ID with populated order
   * Validates shop ownership for non-admin users
   * **Validates: Requirements 3.4**
   * 
   * @param {string} id - Complaint ID (MongoDB _id)
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Complaint with populated order, media attachments, and resolution history
   */
  async findComplaintById(id, user = {}) {
    const complaint = await Complaint.findById(id)
      .populate({
        path: 'orderId',
        select: 'orderId clientInfo items totalAmount status region createdAt',
        populate: {
          path: 'items.productId',
          select: 'name price'
        }
      })
      .populate('shopId', 'name domain')
      .populate('resolvedBy', 'name email')
      .populate('resolutionHistory.userId', 'name email');

    if (!complaint) {
      const error = new Error('Complaint not found');
      error.statusCode = 404;
      error.code = 'COMPLAINT_NOT_FOUND';
      throw error;
    }

    // Check shop ownership for non-admin users
    if (user.role !== 'admin' && user.shopId) {
      const complaintShopId = complaint.shopId?._id || complaint.shopId;
      if (complaintShopId && complaintShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        error.code = 'ACCESS_DENIED';
        throw error;
      }
    }

    return complaint;
  }

  /**
   * Update complaint status and add to resolution history
   * Validates shop ownership, sets resolvedAt/resolvedBy when status is 'resolved' or 'closed'
   * **Validates: Requirements 4.1, 4.3, 4.4**
   * 
   * @param {string} id - Complaint ID (MongoDB _id)
   * @param {string} status - New status
   * @param {string} note - Optional note for the status change
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Updated complaint
   */
  async updateStatus(id, status, note, user) {
    // Find the complaint first
    const complaint = await Complaint.findById(id);

    if (!complaint) {
      const error = new Error('Complaint not found');
      error.statusCode = 404;
      error.code = 'COMPLAINT_NOT_FOUND';
      throw error;
    }

    // Check shop ownership for non-admin users (Requirement 4.4)
    if (user.role !== 'admin' && user.shopId) {
      const complaintShopId = complaint.shopId?.toString() || complaint.shopId;
      if (complaintShopId && complaintShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        error.code = 'ACCESS_DENIED';
        throw error;
      }
    }

    // Update the status
    complaint.status = status;

    // Add entry to resolution history (Requirement 4.1)
    const historyEntry = {
      status,
      note: note || `Status changed to ${status}`,
      userId: user._id || user.id,
      timestamp: new Date()
    };
    complaint.resolutionHistory.push(historyEntry);

    // Set resolvedAt and resolvedBy when status is 'resolved' or 'closed' (Requirement 4.3)
    if (status === 'resolved' || status === 'closed') {
      complaint.resolvedAt = new Date();
      complaint.resolvedBy = user._id || user.id;
    }

    await complaint.save();

    logger.info(`Complaint status updated: ${complaint.referenceNumber}`, {
      complaintId: complaint._id,
      oldStatus: complaint.status,
      newStatus: status,
      userId: user._id || user.id
    });

    // Return populated complaint
    const updatedComplaint = await this.findComplaintById(id, user);

    // Emit WebSocket notification for complaint update
    // **Validates: Requirements 8.2**
    emitComplaintUpdate(updatedComplaint);

    return updatedComplaint;
  }

  /**
   * Add a resolution note to a complaint
   * Appends note with userId, timestamp, content to resolutionHistory
   * **Validates: Requirements 4.2**
   * 
   * @param {string} id - Complaint ID (MongoDB _id)
   * @param {string} note - Note content
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Updated complaint
   */
  async addResolutionNote(id, note, user) {
    // Find the complaint first
    const complaint = await Complaint.findById(id);

    if (!complaint) {
      const error = new Error('Complaint not found');
      error.statusCode = 404;
      error.code = 'COMPLAINT_NOT_FOUND';
      throw error;
    }

    // Check shop ownership for non-admin users
    if (user.role !== 'admin' && user.shopId) {
      const complaintShopId = complaint.shopId?.toString() || complaint.shopId;
      if (complaintShopId && complaintShopId.toString() !== user.shopId.toString()) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        error.code = 'ACCESS_DENIED';
        throw error;
      }
    }

    // Add note to resolution history (Requirement 4.2)
    const historyEntry = {
      status: complaint.status, // Keep current status
      note,
      userId: user._id || user.id,
      timestamp: new Date()
    };
    complaint.resolutionHistory.push(historyEntry);

    await complaint.save();

    logger.info(`Resolution note added: ${complaint.referenceNumber}`, {
      complaintId: complaint._id,
      userId: user._id || user.id
    });

    // Return populated complaint
    return this.findComplaintById(id, user);
  }

  /**
   * Get complaint analytics with aggregations by product, region, and category
   * Calculates complaint counts, resolution rates, and average resolution time
   * **Validates: Requirements 6.1, 6.2, 6.4, 7.1, 7.2**
   * 
   * @param {Object} filters - Filter parameters
   * @param {string} [filters.startDate] - Filter by date range start
   * @param {string} [filters.endDate] - Filter by date range end
   * @param {string} [filters.shopId] - Filter by shop ID (admin only)
   * @param {Object} user - Current user
   * @returns {Promise<Object>} Analytics result with aggregations
   */
  async getAnalytics(filters = {}, user = {}) {
    const { startDate, endDate, shopId } = filters;
    const mongoose = require('mongoose');

    // Build base match query
    const matchQuery = {};

    // Shop isolation: admin can see all shops or filter by shopId
    // Non-admin users can only see their own shop's data (Requirement 7.1, 7.2)
    if (user.role === 'admin') {
      if (shopId) {
        matchQuery.shopId = new mongoose.Types.ObjectId(shopId);
      }
      // If no shopId filter, admin sees all shops
    } else if (user.shopId) {
      matchQuery.shopId = new mongoose.Types.ObjectId(user.shopId);
    }

    // Date range filter (Requirement 6.2)
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) {
        matchQuery.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        matchQuery.createdAt.$lte = new Date(endDate);
      }
    }

    // Run aggregation pipelines in parallel
    const [
      byProduct,
      byRegion,
      byCategory,
      overallStats,
      resolutionTimeStats
    ] = await Promise.all([
      // Aggregate by product (Requirement 6.1)
      Complaint.aggregate([
        { $match: matchQuery },
        { $unwind: { path: '$productIds', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$productIds',
            count: { $sum: 1 },
            resolved: {
              $sum: {
                $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0]
              }
            }
          }
        },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $project: {
            productId: '$_id',
            productName: { $arrayElemAt: ['$product.name', 0] },
            count: 1,
            resolved: 1,
            resolutionRate: {
              $cond: [
                { $eq: ['$count', 0] },
                0,
                { $multiply: [{ $divide: ['$resolved', '$count'] }, 100] }
              ]
            }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Aggregate by region (Requirement 6.1)
      Complaint.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$region',
            count: { $sum: 1 },
            resolved: {
              $sum: {
                $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            region: '$_id',
            count: 1,
            resolved: 1,
            resolutionRate: {
              $cond: [
                { $eq: ['$count', 0] },
                0,
                { $multiply: [{ $divide: ['$resolved', '$count'] }, 100] }
              ]
            }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Aggregate by category (Requirement 6.1)
      Complaint.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            resolved: {
              $sum: {
                $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            resolved: 1,
            resolutionRate: {
              $cond: [
                { $eq: ['$count', 0] },
                0,
                { $multiply: [{ $divide: ['$resolved', '$count'] }, 100] }
              ]
            }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Overall stats (Requirement 6.4)
      Complaint.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalComplaints: { $sum: 1 },
            resolved: {
              $sum: {
                $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0]
              }
            },
            open: {
              $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] }
            },
            inProgress: {
              $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
            },
            escalated: {
              $sum: { $cond: [{ $eq: ['$status', 'escalated'] }, 1, 0] }
            }
          }
        }
      ]),

      // Average resolution time (Requirement 6.4)
      Complaint.aggregate([
        {
          $match: {
            ...matchQuery,
            resolvedAt: { $exists: true, $ne: null }
          }
        },
        {
          $project: {
            resolutionTimeMs: { $subtract: ['$resolvedAt', '$createdAt'] }
          }
        },
        {
          $group: {
            _id: null,
            avgResolutionTimeMs: { $avg: '$resolutionTimeMs' },
            minResolutionTimeMs: { $min: '$resolutionTimeMs' },
            maxResolutionTimeMs: { $max: '$resolutionTimeMs' },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    // Process overall stats
    const stats = overallStats[0] || {
      totalComplaints: 0,
      resolved: 0,
      open: 0,
      inProgress: 0,
      escalated: 0
    };

    // Calculate resolution rate
    const resolutionRate = stats.totalComplaints > 0
      ? (stats.resolved / stats.totalComplaints) * 100
      : 0;

    // Process resolution time stats (convert ms to hours)
    const timeStats = resolutionTimeStats[0] || {
      avgResolutionTimeMs: 0,
      minResolutionTimeMs: 0,
      maxResolutionTimeMs: 0,
      count: 0
    };

    const avgResolutionTimeHours = timeStats.avgResolutionTimeMs
      ? timeStats.avgResolutionTimeMs / (1000 * 60 * 60)
      : 0;

    logger.info('Analytics fetched', {
      shopId: matchQuery.shopId,
      dateRange: { startDate, endDate },
      totalComplaints: stats.totalComplaints
    });

    return {
      summary: {
        totalComplaints: stats.totalComplaints,
        resolved: stats.resolved,
        open: stats.open,
        inProgress: stats.inProgress,
        escalated: stats.escalated,
        resolutionRate: Math.round(resolutionRate * 100) / 100,
        avgResolutionTimeHours: Math.round(avgResolutionTimeHours * 100) / 100
      },
      byProduct: byProduct.map(item => ({
        productId: item.productId,
        productName: item.productName || 'Unknown Product',
        count: item.count,
        resolved: item.resolved,
        resolutionRate: Math.round(item.resolutionRate * 100) / 100
      })),
      byRegion: byRegion.map(item => ({
        region: item.region || 'Unknown Region',
        count: item.count,
        resolved: item.resolved,
        resolutionRate: Math.round(item.resolutionRate * 100) / 100
      })),
      byCategory: byCategory.map(item => ({
        category: item.category,
        count: item.count,
        resolved: item.resolved,
        resolutionRate: Math.round(item.resolutionRate * 100) / 100
      }))
    };
  }

  /**
   * Export complaints to CSV format
   * **Validates: Requirements 9.1, 9.2, 9.3**
   * 
   * @param {Object} filters - Filter parameters (same as findComplaints)
   * @param {Object} user - Current user
   * @returns {Promise<string>} CSV string with headers and data
   */
  async exportToCSV(filters = {}, user = {}) {
    // Get all complaints matching filters (remove pagination limits)
    const exportFilters = {
      ...filters,
      page: 1,
      limit: 10000 // High limit to get all complaints
    };

    const result = await this.findComplaints(exportFilters, user);
    const complaints = result.complaints;

    // CSV headers as specified in Requirements 9.3
    const headers = [
      'referenceNumber',
      'orderId',
      'customerName',
      'category',
      'status',
      'createdAt',
      'resolvedAt',
      'description'
    ];

    // Helper function to escape CSV fields
    const escapeCSVField = (value) => {
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
    };

    // Format date for CSV
    const formatDate = (date) => {
      if (!date) return '';
      return new Date(date).toISOString();
    };

    // Build CSV content
    const rows = [];

    // Add header row
    rows.push(headers.map(escapeCSVField).join(','));

    // Add data rows
    for (const complaint of complaints) {
      const row = [
        escapeCSVField(complaint.referenceNumber),
        escapeCSVField(complaint.orderId?.orderId || complaint.orderId),
        escapeCSVField(complaint.customerInfo?.name),
        escapeCSVField(complaint.category),
        escapeCSVField(complaint.status),
        escapeCSVField(formatDate(complaint.createdAt)),
        escapeCSVField(formatDate(complaint.resolvedAt)),
        escapeCSVField(complaint.description)
      ];
      rows.push(row.join(','));
    }

    logger.info('Complaints exported to CSV', {
      shopId: user.shopId,
      filters,
      count: complaints.length
    });

    return rows.join('\n');
  }
}

module.exports = new ComplaintService();
