const mongoose = require('mongoose');

const courierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  
  contactEmail: String,
  contactPhone: String,
  
  regions: [{
    type: String,
    description: "Regions this courier serves"
  }],
  
  performance: {
    totalDeliveries: {
      type: Number,
      default: 0
    },
    successfulDeliveries: {
      type: Number,
      default: 0
    },
    failedDeliveries: {
      type: Number,
      default: 0
    },
    avgDeliveryTime: {
      type: Number,
      description: "Average delivery time in hours"
    },
    returnRate: {
      type: Number,
      description: "Percentage of returned orders"
    }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Virtual for success rate
courierSchema.virtual('successRate').get(function() {
  if (this.performance.totalDeliveries === 0) return 0;
  return (this.performance.successfulDeliveries / this.performance.totalDeliveries) * 100;
});

// Indexes
courierSchema.index({ isActive: 1 });
courierSchema.index({ regions: 1 });

module.exports = mongoose.model('Courier', courierSchema);
