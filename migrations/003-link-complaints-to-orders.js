/**
 * Migration: Link existing complaints to orders
 * Run with: node migrations/003-link-complaints-to-orders.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../src/models/Order');
const Complaint = require('../src/models/Complaint');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const complaints = await Complaint.find({});
    console.log(`Found ${complaints.length} complaints to process`);

    let updated = 0;
    for (const complaint of complaints) {
      const result = await Order.updateOne(
        { _id: complaint.orderId },
        { $set: { hasComplaint: true } }
      );
      if (result.modifiedCount > 0) {
        updated++;
      }
    }

    console.log(`Updated ${updated} orders with complaint flags`);

    await mongoose.connection.close();
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
