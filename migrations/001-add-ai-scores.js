/**
 * Migration: Add AI scores to existing orders
 * Run with: node migrations/001-add-ai-scores.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../src/models/Order');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await Order.updateMany(
      { aiScore: { $exists: false } },
      { 
        $set: { 
          aiScore: 50,  // Default neutral score
          riskLevel: 'medium',
          deliverySuccessProbability: 70,
          hasComplaint: false
        } 
      }
    );

    console.log(`Updated ${result.modifiedCount} orders with default AI scores`);

    await mongoose.connection.close();
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
