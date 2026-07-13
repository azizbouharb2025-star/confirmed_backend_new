const Order = require('../models/Order');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Complaint = require('../models/Complaint');
const Courier = require('../models/Courier');
const Product = require('../models/Product');

class AnalyticsService {
  /**
   * Get frontend dashboard metrics
   * Returns metrics in the format expected by the frontend
   */
  async getFrontendDashboardMetrics(shopId = null) {
      const matchStage = shopId ? { shopId } : {};
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [allTimeStats, todayStats, yesterdayStats, revenueStats, shippedStats, deliveryStats, complaintStats, resolutionStats] = await Promise.all([
        // All-time order stats
        Order.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              revenue: { $sum: '$totalAmount' }
            }
          }
        ]),
        // Today's order stats for comparison
        Order.aggregate([
          { $match: { ...matchStage, createdAt: { $gte: today } } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              revenue: { $sum: '$totalAmount' }
            }
          }
        ]),
        // Yesterday's stats for comparison
        Order.aggregate([
          { $match: { ...matchStage, createdAt: { $gte: yesterday, $lt: today } } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalAmount' }
            }
          }
        ]),
        // Total revenue from confirmed/delivered orders (all-time)
        Order.aggregate([
          { 
            $match: { 
              ...matchStage, 
              status: { $in: ['confirmed', 'delivered'] }
            } 
          },
          {
            $group: {
              _id: null,
              revenue: { $sum: '$totalAmount' },
              count: { $sum: 1 }
            }
          }
        ]),
        // Shipped orders count (all-time)
        Order.countDocuments({
          ...matchStage,
          status: { $in: ['shipped', 'delivered'] }
        }),
        // Delivery success rate (last 7 days)
        Order.aggregate([
          {
            $match: {
              ...matchStage,
              createdAt: { $gte: sevenDaysAgo },
              status: { $in: ['shipped', 'delivered', 'failed_delivery'] }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: {
                $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
              }
            }
          }
        ]),
        // Complaint rate (all-time)
        Order.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              withComplaints: {
                $sum: { $cond: ['$hasComplaint', 1, 0] }
              }
            }
          }
        ]),
        // Average resolution time (all-time)
        Complaint.aggregate([
          {
            $match: {
              ...matchStage,
              status: 'resolved',
              resolvedAt: { $exists: true }
            }
          },
          {
            $project: {
              resolutionTime: {
                $divide: [
                  { $subtract: ['$resolvedAt', '$createdAt'] },
                  1000 * 60 * 60 // Convert to hours
                ]
              }
            }
          },
          {
            $group: {
              _id: null,
              avgResolutionTime: { $avg: '$resolutionTime' }
            }
          }
        ])
      ]);

      // Calculate metrics from all-time data
      const statusCounts = allTimeStats.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {});

      const ordersReceived = Object.values(statusCounts).reduce((a, b) => a + b, 0);
      const ordersConfirmed = statusCounts.confirmed || 0;
      const ordersPending = statusCounts.pending || 0;
      const ordersRejected = (statusCounts.rejected || 0) + (statusCounts.cancelled || 0);
      const ordersShipped = shippedStats;
      const confirmationRate = ordersReceived > 0 
        ? parseFloat(((ordersConfirmed / ordersReceived) * 100).toFixed(1))
        : 0;

      const deliveryData = deliveryStats[0] || { total: 0, successful: 0 };
      const deliverySuccessRate = deliveryData.total > 0
        ? parseFloat(((deliveryData.successful / deliveryData.total) * 100).toFixed(1))
        : 0;

      const complaintData = complaintStats[0] || { total: 0, withComplaints: 0 };
      const complaintRate = complaintData.total > 0
        ? parseFloat(((complaintData.withComplaints / complaintData.total) * 100).toFixed(1))
        : 0;

      const avgResolutionTime = resolutionStats[0]?.avgResolutionTime 
        ? parseFloat(resolutionStats[0].avgResolutionTime.toFixed(1))
        : 0;

      const allTimeRevenue = revenueStats[0]?.revenue || 0;
      const todayRevenue = todayStats.reduce((sum, s) => sum + (s.revenue || 0), 0);
      const yesterdayRevenue = yesterdayStats[0]?.totalRevenue || 0;
      const revenueChange = yesterdayRevenue > 0 
        ? parseFloat((((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1))
        : 0;

      const confirmedOrders = revenueStats[0]?.count || 1;
      const averageOrderValue = confirmedOrders > 0 
        ? parseFloat((allTimeRevenue / confirmedOrders).toFixed(2))
        : 0;

      return {
        ordersReceived,
        ordersConfirmed,
        ordersPending,
        ordersRejected,
        ordersShipped,
        confirmationRate,
        deliverySuccessRate,
        complaintRate,
        avgResolutionTime,
        revenue: allTimeRevenue,
        revenueChange,
        averageOrderValue
      };
    }


  /**
   * Get AI risk score distribution (Pro+ plans)
   */
  async getRiskScoreDistribution(shopId = null) {
    const matchStage = shopId ? { shopId, aiRiskScore: { $exists: true } } : { aiRiskScore: { $exists: true } };

    const distribution = await Order.aggregate([
      { $match: matchStage },
      {
        $bucket: {
          groupBy: '$aiRiskScore',
          boundaries: [0, 20, 40, 60, 80, 100],
          default: 'unknown',
          output: {
            count: { $sum: 1 },
            avgAmount: { $avg: '$totalAmount' }
          }
        }
      }
    ]);

    const labels = ['0-20 (Low)', '20-40', '40-60', '60-80', '80-100 (High)'];
    const result = labels.map((label, index) => {
      const bucket = distribution.find(d => d._id === index * 20);
      return {
        range: label,
        count: bucket?.count || 0,
        avgOrderValue: bucket?.avgAmount?.toFixed(2) || 0
      };
    });

    return {
      distribution: result,
      totalAnalyzed: distribution.reduce((sum, d) => sum + (d.count || 0), 0)
    };
  }

  /**
   * Get operator feedback analytics (Pro+ plans)
   */
  async getOperatorFeedbackAnalytics(shopId = null) {
    const matchStage = shopId 
      ? { shopId, operatorFeedback: { $exists: true, $ne: '' } }
      : { operatorFeedback: { $exists: true, $ne: '' } };

    const [feedbackStats, recentFeedback] = await Promise.all([
      Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      Order.find(matchStage)
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('orderId operatorFeedback status updatedAt')
        .lean()
    ]);

    return {
      summary: feedbackStats.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {}),
      totalWithFeedback: feedbackStats.reduce((sum, s) => sum + s.count, 0),
      recentFeedback: recentFeedback.map(f => ({
        orderId: f.orderId,
        feedback: f.operatorFeedback,
        status: f.status,
        timestamp: f.updatedAt
      }))
    };
  }

  /**
   * Get complaints analytics (Business+ plans)
   */
  async getComplaintsAnalytics(shopId = null) {
    const matchStage = shopId ? { shopId } : {};
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalComplaints, resolvedComplaints, trendData, categories, topProducts, weekStats] = await Promise.all([
      // Total complaints
      Complaint.countDocuments(matchStage),
      // Resolved complaints
      Complaint.countDocuments({ ...matchStage, status: 'resolved' }),
      // Trend data (last 30 days)
      Complaint.aggregate([
        { 
          $match: { 
            ...matchStage,
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
          } 
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      // By category
      Complaint.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),
      // Top products with complaints
      Complaint.aggregate([
        { $match: matchStage },
        { $unwind: '$productIds' },
        {
          $group: {
            _id: '$productIds',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
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
            count: 1
          }
        }
      ]),
      // This week stats
      Complaint.aggregate([
        { $match: { ...matchStage, createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const resolutionRate = totalComplaints > 0
      ? parseFloat(((resolvedComplaints / totalComplaints) * 100).toFixed(1))
      : 0;

    const weekStatsMap = weekStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    return {
      totalComplaints,
      resolutionRate,
      trendData: trendData.map(t => ({
        date: t._id,
        count: t.count
      })),
      categories: categories.map(c => ({
        category: c._id,
        count: c.count
      })),
      topProductsWithComplaints: topProducts,
      complaintsThisWeek: {
        new: weekStatsMap.open || 0,
        resolved: weekStatsMap.resolved || 0
      }
    };
  }

  /**
   * Get courier performance analytics (Business+ plans)
   */
  async getCourierPerformanceAnalytics(shopId = null) {
    const matchStage = shopId ? { shopId } : {};

    const couriers = await Courier.find({ isActive: true });

    const courierData = await Promise.all(couriers.map(async (courier) => {
      const orders = await Order.find({ 
        ...matchStage,
        courier: courier._id
      });
      
      const successful = orders.filter(o => o.status === 'delivered').length;
      const total = orders.length;
      
      return {
        name: courier.name,
        successRate: total > 0 ? parseFloat(((successful / total) * 100).toFixed(1)) : 0,
        avgDeliveryTime: courier.performance.avgDeliveryTime || 0,
        totalDeliveries: total,
        returnRate: courier.performance.returnRate || 0
      };
    }));

    return {
      couriers: courierData.sort((a, b) => b.successRate - a.successRate)
    };
  }

  /**
   * Get predictive analytics (Enterprise plans)
   */
  async getPredictiveAnalytics(shopId = null) {
    const matchStage = shopId ? { shopId } : {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [orderTrend, repeatBuyers, highValueCustomers] = await Promise.all([
      // Order volume trend
      Order.aggregate([
        { $match: { ...matchStage, createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
            revenue: { $sum: '$totalAmount' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      // Repeat buyer analysis
      Order.aggregate([
        { $match: { ...matchStage, isRepeatBuyer: true } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgValue: { $avg: '$totalAmount' }
          }
        }
      ]),
      // High value customers
      Order.aggregate([
        { $match: { ...matchStage, customerLifetimeValue: { $gt: 0 } } },
        {
          $group: {
            _id: '$clientInfo.phone',
            totalValue: { $sum: '$customerLifetimeValue' },
            orderCount: { $sum: 1 }
          }
        },
        { $sort: { totalValue: -1 } },
        { $limit: 10 }
      ])
    ]);

    // Simple prediction based on trend
    const avgDailyOrders = orderTrend.length > 0 
      ? orderTrend.reduce((sum, d) => sum + d.count, 0) / orderTrend.length 
      : 0;
    const avgDailyRevenue = orderTrend.length > 0 
      ? orderTrend.reduce((sum, d) => sum + d.revenue, 0) / orderTrend.length 
      : 0;

    return {
      predictions: {
        nextWeekOrders: Math.round(avgDailyOrders * 7),
        nextWeekRevenue: parseFloat((avgDailyRevenue * 7).toFixed(2)),
        growthTrend: orderTrend.length >= 7 
          ? parseFloat(((orderTrend[orderTrend.length - 1]?.count - orderTrend[0]?.count) / Math.max(orderTrend[0]?.count, 1) * 100).toFixed(1))
          : 0
      },
      repeatBuyers: {
        count: repeatBuyers[0]?.count || 0,
        avgOrderValue: parseFloat((repeatBuyers[0]?.avgValue || 0).toFixed(2))
      },
      topCustomers: highValueCustomers.map(c => ({
        phone: c._id?.substring(0, 4) + '****' + c._id?.substring(c._id.length - 2),
        lifetimeValue: c.totalValue,
        orderCount: c.orderCount
      })),
      trend: orderTrend
    };
  }

  /**
   * Get automation recommendations (Enterprise plans)
   */
  async getAutomationRecommendations(shopId = null) {
    const matchStage = shopId ? { shopId } : {};
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [statusDistribution, peakHours, riskAnalysis] = await Promise.all([
      // Status distribution
      Order.aggregate([
        { $match: { ...matchStage, createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      // Peak hours analysis
      Order.aggregate([
        { $match: { ...matchStage, createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),
      // Risk score analysis
      Order.aggregate([
        { $match: { ...matchStage, aiRiskScore: { $exists: true } } },
        {
          $group: {
            _id: null,
            avgRisk: { $avg: '$aiRiskScore' },
            highRiskCount: { $sum: { $cond: [{ $gte: ['$aiRiskScore', 70] }, 1, 0] } },
            total: { $sum: 1 }
          }
        }
      ])
    ]);

    const recommendations = [];
    const statusMap = statusDistribution.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    // Generate recommendations based on data
    const totalOrders = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const pendingRate = totalOrders > 0 ? (statusMap.pending || 0) / totalOrders : 0;
    const cancelRate = totalOrders > 0 ? (statusMap.cancelled || 0) / totalOrders : 0;

    if (pendingRate > 0.3) {
      recommendations.push({
        id: 'auto_confirm',
        title: 'Enable Auto-Confirmation',
        description: 'High pending rate detected. Consider enabling auto-confirmation for low-risk orders.',
        impact: 'high',
        estimatedSavings: Math.round(statusMap.pending * 2) + ' minutes/day'
      });
    }

    if (cancelRate > 0.1) {
      recommendations.push({
        id: 'risk_screening',
        title: 'Enhance Risk Screening',
        description: 'Cancellation rate is above threshold. Implement stricter risk screening.',
        impact: 'medium',
        estimatedSavings: Math.round(statusMap.cancelled * 5) + ' TND/day'
      });
    }

    if (peakHours.length > 0) {
      recommendations.push({
        id: 'peak_staffing',
        title: 'Optimize Peak Hour Staffing',
        description: `Peak hours detected at ${peakHours.slice(0, 3).map(h => h._id + ':00').join(', ')}. Consider adjusting operator schedules.`,
        impact: 'medium',
        estimatedSavings: '15% efficiency improvement'
      });
    }

    if (riskAnalysis[0]?.highRiskCount > 0) {
      recommendations.push({
        id: 'ai_calling',
        title: 'AI-Assisted Calling',
        description: `${riskAnalysis[0].highRiskCount} high-risk orders detected. Use AI calling for initial verification.`,
        impact: 'high',
        estimatedSavings: Math.round(riskAnalysis[0].highRiskCount * 3) + ' minutes/day'
      });
    }

    return {
      recommendations,
      metrics: {
        pendingRate: parseFloat((pendingRate * 100).toFixed(1)),
        cancelRate: parseFloat((cancelRate * 100).toFixed(1)),
        avgRiskScore: parseFloat((riskAnalysis[0]?.avgRisk || 0).toFixed(1)),
        peakHours: peakHours.map(h => ({ hour: h._id, orders: h.count }))
      }
    };
  }

  async getCallEfficiency(shopId, timeRange = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeRange);

    const stats = await Order.aggregate([
      {
        $match: {
          shopId,
          createdAt: { $gte: startDate },
          callHistory: { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: '$callHistory'
      },
      {
        $group: {
          _id: '$callHistory.callType',
          totalCalls: { $sum: 1 },
          confirmed: {
            $sum: { $cond: [{ $eq: ['$callHistory.result', 'confirmed'] }, 1, 0] }
          },
          avgDuration: { $avg: '$callHistory.duration' }
        }
      }
    ]);

    return stats.reduce((acc, stat) => {
      acc[stat._id] = {
        totalCalls: stat.totalCalls,
        confirmationRate: (stat.confirmed / stat.totalCalls * 100).toFixed(2),
        avgDuration: stat.avgDuration
      };
      return acc;
    }, {});
  }

  async getOperatorPerformance(timeRange = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeRange);

    return await Order.aggregate([
      {
        $match: {
          assignedOperatorId: { $exists: true },
          updatedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$assignedOperatorId',
          totalOrders: { $sum: 1 },
          confirmed: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          avgProcessingTime: {
            $avg: { $subtract: ['$updatedAt', '$createdAt'] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'operator'
        }
      },
      {
        $project: {
          operatorName: { $arrayElemAt: ['$operator.name', 0] },
          totalOrders: 1,
          confirmationRate: {
            $multiply: [{ $divide: ['$confirmed', '$totalOrders'] }, 100]
          },
          avgProcessingTime: { $divide: ['$avgProcessingTime', 1000 * 60] } // minutes
        }
      }
    ]);
  }

  async getRevenueAnalytics() {
    const revenue = await Subscription.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.amount' }
        }
      }
    ]);

    const totalRevenue = revenue.reduce((sum, plan) => sum + plan.totalRevenue, 0);
    const totalSubscriptions = revenue.reduce((sum, plan) => sum + plan.count, 0);

    return {
      totalRevenue,
      totalSubscriptions,
      revenueByPlan: revenue,
      avgRevenuePerUser: totalRevenue / totalSubscriptions
    };
  }

  async getDashboardMetrics(shopId = null) {
    const matchStage = shopId ? { shopId } : {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [orderStats, callStats, recentActivity] = await Promise.all([
      Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      Order.aggregate([
        {
          $match: {
            ...matchStage,
            createdAt: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: { $size: '$callHistory' } },
            aiCalls: {
              $sum: {
                $size: {
                  $filter: {
                    input: '$callHistory',
                    cond: { $eq: ['$$this.callType', 'ai'] }
                  }
                }
              }
            }
          }
        }
      ]),
      Order.find(matchStage)
        .sort({ updatedAt: -1 })
        .limit(10)
        .populate('assignedOperatorId', 'name')
        .select('orderId status updatedAt clientInfo.name')
    ]);

    return {
      orderStats: orderStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      callStats: callStats[0] || { totalCalls: 0, aiCalls: 0 },
      recentActivity
    };
  }

  /**
   * Get product performance analytics
   */
  async getProductPerformanceAnalytics(shopId = null) {
    const matchStage = shopId ? { shopId } : {};

    const productStats = await Order.aggregate([
      { $match: matchStage },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          productName: { $first: '$items.name' },
          totalOrders: { $sum: 1 },
          confirmedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $in: ['$status', ['cancelled', 'rejected']] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'complaints',
          localField: '_id',
          foreignField: 'productIds',
          as: 'complaints'
        }
      },
      {
        $project: {
          productId: '$_id',
          productName: 1,
          totalOrders: 1,
          confirmedOrders: 1,
          confirmationRate: {
            $multiply: [
              { $divide: ['$confirmedOrders', { $max: ['$totalOrders', 1] }] },
              100
            ]
          },
          complaintCount: { $size: '$complaints' },
          complaintRate: {
            $multiply: [
              { $divide: [{ $size: '$complaints' }, { $max: ['$totalOrders', 1] }] },
              100
            ]
          }
        }
      },
      { $sort: { totalOrders: -1 } },
      { $limit: 20 }
    ]);

    // Get cancellation reasons for products
    const cancellationReasons = await Order.aggregate([
      { 
        $match: { 
          ...matchStage, 
          cancellationReason: { $exists: true } 
        } 
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            productId: '$items.productId',
            reason: '$cancellationReason'
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Map cancellation reasons to products
    const reasonsMap = {};
    cancellationReasons.forEach(r => {
      const productId = r._id.productId?.toString();
      if (!reasonsMap[productId]) {
        reasonsMap[productId] = {};
      }
      reasonsMap[productId][r._id.reason] = r.count;
    });

    return {
      products: productStats.map(p => ({
        productId: p.productId,
        productName: p.productName,
        totalOrders: p.totalOrders,
        confirmedOrders: p.confirmedOrders,
        confirmationRate: parseFloat(p.confirmationRate.toFixed(1)),
        cancellationReasons: reasonsMap[p.productId?.toString()] || {},
        complaintCount: p.complaintCount,
        complaintRate: parseFloat(p.complaintRate.toFixed(1))
      }))
    };
  }

  /**
   * Get comprehensive statistics with filters
   */
  async getStatistics(shopId = null, filters = {}) {
    const { startDate, endDate, groupBy = 'day' } = filters;
    const matchStage = shopId ? { shopId } : {};

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const [orderStats, revenueStats, complaintStats, timeline] = await Promise.all([
      // Order statistics
      Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      // Revenue statistics
      Order.aggregate([
        { 
          $match: { 
            ...matchStage, 
            status: { $in: ['confirmed', 'delivered'] } 
          } 
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' },
            average: { $avg: '$totalAmount' },
            count: { $sum: 1 }
          }
        }
      ]),
      // Complaint statistics
      Complaint.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      // Timeline data
      Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            orders: { $sum: 1 },
            revenue: { 
              $sum: { 
                $cond: [
                  { $in: ['$status', ['confirmed', 'delivered']] },
                  '$totalAmount',
                  0
                ]
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    const orderStatsMap = orderStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    const complaintStatsMap = complaintStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    return {
      period: {
        start: startDate || 'all',
        end: endDate || 'now'
      },
      orders: {
        total: Object.values(orderStatsMap).reduce((a, b) => a + b, 0),
        confirmed: orderStatsMap.confirmed || 0,
        cancelled: (orderStatsMap.cancelled || 0) + (orderStatsMap.rejected || 0),
        shipped: orderStatsMap.shipped || 0,
        delivered: orderStatsMap.delivered || 0
      },
      revenue: {
        total: revenueStats[0]?.total || 0,
        average: revenueStats[0]?.average || 0
      },
      complaints: {
        total: Object.values(complaintStatsMap).reduce((a, b) => a + b, 0),
        resolved: complaintStatsMap.resolved || 0,
        pending: (complaintStatsMap.open || 0) + (complaintStatsMap.in_progress || 0)
      },
      timeline: timeline.map(t => ({
        date: t._id,
        orders: t.orders,
        revenue: t.revenue
      }))
    };
  }

  /**
   * Get AI insights (Enterprise plans)
   */
  async getAIInsights(shopId = null) {
    const matchStage = shopId ? { shopId } : {};

    const [highRiskOrders, courierAnalysis, productAnalysis, repeatBuyerStats] = await Promise.all([
      // High risk orders
      Order.find({
        ...matchStage,
        status: 'pending',
        aiScore: { $lt: 50 }
      })
        .sort({ aiScore: 1 })
        .limit(10)
        .select('orderId aiScore riskLevel totalAmount region'),
      
      // Courier performance comparison
      Order.aggregate([
        { 
          $match: { 
            ...matchStage,
            courier: { $exists: true },
            region: { $exists: true }
          } 
        },
        {
          $group: {
            _id: { courier: '$courier', region: '$region' },
            total: { $sum: 1 },
            successful: {
              $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
            }
          }
        },
        {
          $lookup: {
            from: 'couriers',
            localField: '_id.courier',
            foreignField: '_id',
            as: 'courierInfo'
          }
        },
        {
          $project: {
            region: '$_id.region',
            courierName: { $arrayElemAt: ['$courierInfo.name', 0] },
            successRate: {
              $multiply: [
                { $divide: ['$successful', { $max: ['$total', 1] }] },
                100
              ]
            }
          }
        }
      ]),

      // Product cancellation analysis
      Order.aggregate([
        {
          $match: {
            ...matchStage,
            status: { $in: ['cancelled', 'rejected'] },
            cancellationReason: { $exists: true }
          }
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              productId: '$items.productId',
              region: '$region',
              reason: '$cancellationReason'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      // Repeat buyer insights
      Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$clientInfo.phone',
            orderCount: { $sum: 1 },
            totalValue: { $sum: '$totalAmount' },
            avgOrderValue: { $avg: '$totalAmount' }
          }
        },
        {
          $match: { orderCount: { $gt: 1 } }
        },
        {
          $group: {
            _id: null,
            totalRepeatBuyers: { $sum: 1 },
            avgLifetimeValue: { $avg: '$totalValue' },
            avgOrderCount: { $avg: '$orderCount' }
          }
        }
      ])
    ]);

    const recommendations = [];

    // Generate courier recommendations
    const couriersByRegion = {};
    courierAnalysis.forEach(c => {
      if (!couriersByRegion[c.region]) {
        couriersByRegion[c.region] = [];
      }
      couriersByRegion[c.region].push(c);
    });

    Object.entries(couriersByRegion).forEach(([region, couriers]) => {
      if (couriers.length > 1) {
        const sorted = couriers.sort((a, b) => b.successRate - a.successRate);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        
        if (best.successRate - worst.successRate > 20) {
          recommendations.push({
            type: 'courier_switch',
            message: `Switch to ${best.courierName} in ${region}, success rate ${best.successRate.toFixed(1)}% vs ${worst.successRate.toFixed(1)}% for ${worst.courierName}`,
            impact: 'high',
            estimatedImprovement: `+${(best.successRate - worst.successRate).toFixed(1)}% success rate`
          });
        }
      }
    });

    // Generate product recommendations
    productAnalysis.forEach(p => {
      if (p.count > 5) {
        recommendations.push({
          type: 'product_adjustment',
          message: `Product cancellations in ${p._id.region} due to ${p._id.reason} (${p.count} times)`,
          impact: 'medium',
          estimatedImprovement: 'Reduce cancellations by addressing root cause'
        });
      }
    });

    const totalOrders = await Order.countDocuments(matchStage);
    const repeatBuyerData = repeatBuyerStats[0] || {
      totalRepeatBuyers: 0,
      avgLifetimeValue: 0,
      avgOrderCount: 0
    };

    return {
      highRiskOrders: highRiskOrders.map(o => ({
        orderId: o.orderId,
        aiScore: o.aiScore,
        reason: o.riskLevel === 'high' ? 'High risk detected by AI' : 'Medium risk',
        recommendation: o.aiScore < 30 ? 'Cancel or review manually' : 'Review before confirming',
        estimatedLoss: o.totalAmount
      })),
      recommendations,
      repeatBuyerInsights: {
        percentageReturningCustomers: totalOrders > 0 
          ? parseFloat(((repeatBuyerData.totalRepeatBuyers / totalOrders) * 100).toFixed(1))
          : 0,
        avgLifetimeValue: parseFloat((repeatBuyerData.avgLifetimeValue || 0).toFixed(2)),
        avgOrdersPerCustomer: parseFloat((repeatBuyerData.avgOrderCount || 0).toFixed(1))
      }
    };
  }

  /**
   * Get operator feedback with confidence breakdown
   */
  async getOperatorFeedbackEnhanced(shopId = null) {
    const matchStage = shopId ? { shopId } : {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [confidenceBreakdown, todayConfirmations] = await Promise.all([
      Order.aggregate([
        { 
          $match: { 
            ...matchStage,
            'operatorFeedback.confidence': { $exists: true }
          } 
        },
        {
          $group: {
            _id: '$operatorFeedback.confidence',
            count: { $sum: 1 }
          }
        }
      ]),
      Order.aggregate([
        {
          $match: {
            ...matchStage,
            createdAt: { $gte: today },
            'operatorFeedback.confidence': 'strong',
            status: 'confirmed'
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const confidenceMap = confidenceBreakdown.reduce((acc, c) => {
      acc[c._id] = c.count;
      return acc;
    }, {});

    const totalWithFeedback = Object.values(confidenceMap).reduce((a, b) => a + b, 0);
    const strongConfirmations = todayConfirmations[0]?.count || 0;
    const todayTotal = await Order.countDocuments({ ...matchStage, createdAt: { $gte: today } });

    return {
      confidenceBreakdown: {
        strong: confidenceMap.strong || 0,
        doubtful: confidenceMap.doubtful || 0,
        neutral: confidenceMap.neutral || 0
      },
      strongConfirmationRate: todayTotal > 0
        ? parseFloat(((strongConfirmations / todayTotal) * 100).toFixed(1))
        : 0,
      totalWithFeedback
    };
  }

}

module.exports = new AnalyticsService();
