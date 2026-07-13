const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    // Create indexes for performance (non-blocking)
    createIndexes();
    
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error('Database connection error:', error);
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    
    // Create indexes with specific names to avoid conflicts
    const indexOperations = [
      { collection: 'orders', index: { shopId: 1, status: 1 }, options: { name: 'shop_status_idx' } },
      { collection: 'orders', index: { assignedOperatorId: 1 }, options: { name: 'operator_idx' } },
      { collection: 'orders', index: { orderId: 1, shopId: 1 }, options: { unique: true, name: 'order_shop_unique' } },
      { collection: 'shops', index: { domain: 1 }, options: { unique: true, name: 'domain_unique' } },
      { collection: 'users', index: { email: 1 }, options: { unique: true, name: 'email_unique' } }
    ];

    for (const { collection, index, options } of indexOperations) {
      try {
        await db.collection(collection).createIndex(index, options);
      } catch (err) {
        if (err.code !== 86) { // Ignore index already exists error
          throw err;
        }
      }
    }

    logger.info('Database indexes verified');
  } catch (error) {
    logger.warn('Index creation warning:', error.message);
  }
};

module.exports = connectDB;