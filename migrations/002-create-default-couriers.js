/**
 * Migration: Create default couriers
 * Run with: node migrations/002-create-default-couriers.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Courier = require('../src/models/Courier');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const defaultCouriers = [
      { 
        name: 'Courier A', 
        regions: ['Tunis', 'Ariana', 'Ben Arous'],
        contactEmail: 'contact@couriera.tn',
        contactPhone: '+216 XX XXX XXX',
        performance: {
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          avgDeliveryTime: 48,
          returnRate: 5
        }
      },
      { 
        name: 'Courier B', 
        regions: ['Sfax', 'Sousse', 'Monastir'],
        contactEmail: 'contact@courierb.tn',
        contactPhone: '+216 XX XXX XXX',
        performance: {
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          avgDeliveryTime: 36,
          returnRate: 3
        }
      },
      { 
        name: 'Courier C', 
        regions: ['Bizerte', 'Nabeul', 'Zaghouan'],
        contactEmail: 'contact@courierc.tn',
        contactPhone: '+216 XX XXX XXX',
        performance: {
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          avgDeliveryTime: 42,
          returnRate: 4
        }
      }
    ];

    for (const courierData of defaultCouriers) {
      const existing = await Courier.findOne({ name: courierData.name });
      if (!existing) {
        await Courier.create(courierData);
        console.log(`Created courier: ${courierData.name}`);
      } else {
        console.log(`Courier already exists: ${courierData.name}`);
      }
    }

    await mongoose.connection.close();
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
