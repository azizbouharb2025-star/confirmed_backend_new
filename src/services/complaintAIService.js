const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Complaint AI Tagging Service
 * Handles AI-based complaint categorization
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */
class ComplaintAIService {
  constructor() {
    this.apiUrl = process.env.AI_SERVICE_URL;
    this.apiKey = process.env.AI_SERVICE_API_KEY;
  }

  /**
   * Analyze complaint description and generate tags with confidence scores
   * **Validates: Requirements 5.1, 5.2, 5.3**
   * 
   * @param {string} description - Complaint description text
   * @returns {Promise<Object>} { tags: Array<{tag, confidence}>, primaryCategory, success }
   */
  async analyzeComplaint(description) {
    try {
      if (!description || typeof description !== 'string') {
        logger.warn('Invalid description provided for AI analysis');
        return {
          tags: [],
          primaryCategory: null,
          success: false
        };
      }

      const response = await axios.post(
        `${this.apiUrl}/analyze-complaint`,
        { description },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      // Parse response into tags with confidence scores
      const tags = this._parseTagsFromResponse(response.data);
      
      // Select primary category from highest confidence tag (Requirement 5.3)
      const primaryCategory = this._selectPrimaryCategory(tags);

      logger.info('AI complaint analysis completed', {
        tagsCount: tags.length,
        primaryCategory
      });

      return {
        tags,
        primaryCategory,
        success: true
      };
    } catch (error) {
      // Handle failures gracefully (Requirement 5.4)
      logger.error('AI complaint analysis failed:', {
        error: error.message,
        code: error.code
      });

      return {
        tags: [],
        primaryCategory: null,
        success: false
      };
    }
  }

  /**
   * Parse AI service response into standardized tags format
   * Each tag has a confidence score between 0-100
   * **Validates: Requirements 5.2**
   * 
   * @param {Object} responseData - Raw response from AI service
   * @returns {Array<{tag: string, confidence: number}>} Parsed tags
   * @private
   */
  _parseTagsFromResponse(responseData) {
    if (!responseData || !responseData.tags) {
      return [];
    }

    const tags = [];
    
    for (const tagData of responseData.tags) {
      // Ensure tag has required fields
      if (tagData.tag && typeof tagData.confidence === 'number') {
        // Normalize confidence to 0-100 range
        const confidence = Math.max(0, Math.min(100, Math.round(tagData.confidence)));
        
        tags.push({
          tag: String(tagData.tag),
          confidence
        });
      }
    }

    // Sort by confidence descending
    tags.sort((a, b) => b.confidence - a.confidence);

    return tags;
  }

  /**
   * Select primary category from highest confidence tag
   * **Validates: Requirements 5.3**
   * 
   * @param {Array<{tag: string, confidence: number}>} tags - Parsed tags
   * @returns {string|null} Primary category (highest confidence tag)
   * @private
   */
  _selectPrimaryCategory(tags) {
    if (!tags || tags.length === 0) {
      return null;
    }

    // Tags are already sorted by confidence descending
    return tags[0].tag;
  }

  /**
   * Retry failed tagging for manual review queue
   * 
   * @param {string} complaintId - Complaint ID to retry tagging for
   * @returns {Promise<void>}
   */
  async retryTagging(complaintId) {
    const Complaint = require('../models/Complaint');
    
    try {
      const complaint = await Complaint.findById(complaintId);
      
      if (!complaint) {
        logger.warn('Complaint not found for retry tagging', { complaintId });
        return;
      }

      const result = await this.analyzeComplaint(complaint.description);

      if (result.success) {
        complaint.aiTags = result.tags;
        complaint.aiPrimaryCategory = result.primaryCategory;
        complaint.requiresManualReview = false;
        await complaint.save();

        logger.info('Retry tagging successful', {
          complaintId,
          primaryCategory: result.primaryCategory
        });
      } else {
        logger.warn('Retry tagging failed, keeping manual review flag', { complaintId });
      }
    } catch (error) {
      logger.error('Error during retry tagging:', {
        complaintId,
        error: error.message
      });
    }
  }
}

module.exports = new ComplaintAIService();
