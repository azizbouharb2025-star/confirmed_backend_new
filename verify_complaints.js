require('dotenv').config();
const mongoose = require('mongoose');

const User = require('./src/models/User');
const Shop = require('./src/models/Shop');
const Complaint = require('./src/models/Complaint');
const Order = require('./src/models/Order');

async function verifyComplaints() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');
    
    // Find the shop owner
    const owner = await User.findOne({ email: 'owner@techstore.tn' }).populate('shopId');
    
    if (!owner) {
      console.log('❌ Shop owner not found!');
      return;
    }
    
    console.log('👤 Shop Owner:');
    console.log('   Email:', owner.email);
    console.log('   Name:', owner.firstName, owner.lastName);
    console.log('   Shop ID:', owner.shopId ? owner.shopId._id : '❌ NO SHOP');
    
    if (!owner.shopId) {
      console.log('\n❌ Shop owner has no shop linked!');
      return;
    }
    
    console.log('   Shop Name:', owner.shopId.name);
    console.log('   Shop Domain:', owner.shopId.domain);
    
    // Check subscription tier
    const shop = await Shop.findById(owner.shopId._id).populate('subscriptionId');
    console.log('\n💳 Subscription:');
    console.log('   Plan:', shop.subscriptionId?.plan || 'NO SUBSCRIPTION');
    console.log('   Status:', shop.subscriptionId?.status || 'N/A');
    
    // Find complaints for this shop
    const complaints = await Complaint.find({ shopId: owner.shopId._id })
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log('\n📝 Complaints for this shop:');
    console.log('   Total:', await Complaint.countDocuments({ shopId: owner.shopId._id }));
    
    if (complaints.length === 0) {
      console.log('   ❌ No complaints found for this shop!');
    } else {
      console.log('   ✅ Found', complaints.length, 'recent complaints\n');
      
      // Show complaint status breakdown
      const statusCounts = await Complaint.aggregate([
        { $match: { shopId: owner.shopId._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      
      console.log('   Status breakdown:');
      statusCounts.forEach(s => {
        console.log(`      ${s._id}: ${s.count}`);
      });
      
      // Show category breakdown
      const categoryCounts = await Complaint.aggregate([
        { $match: { shopId: owner.shopId._id } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      
      console.log('\n   Category breakdown:');
      categoryCounts.forEach(c => {
        console.log(`      ${c._id}: ${c.count}`);
      });
      
      // Show sample complaints
      console.log('\n   Sample complaints:');
      complaints.slice(0, 5).forEach((c, i) => {
        console.log(`\n   ${i + 1}. ${c.referenceNumber}`);
        console.log(`      Status: ${c.status}`);
        console.log(`      Category: ${c.category}`);
        console.log(`      Customer: ${c.customerInfo.name}`);
        console.log(`      Description: ${c.description.substring(0, 60)}...`);
        console.log(`      Created: ${c.createdAt.toISOString().split('T')[0]}`);
      });
    }
    
    // Check orders with complaints
    const ordersWithComplaints = await Order.countDocuments({ 
      shopId: owner.shopId._id,
      hasComplaint: true 
    });
    
    console.log('\n📦 Orders:');
    console.log('   Total orders:', await Order.countDocuments({ shopId: owner.shopId._id }));
    console.log('   Orders with complaints:', ordersWithComplaints);
    
    // Test API access simulation
    console.log('\n🔐 Access Check:');
    const tierCheck = require('./src/middleware/tierCheck');
    const tier = await tierCheck.getUserTier(owner);
    console.log('   User tier:', tier);
    console.log('   Has Pro access:', tierCheck.tierMeetsMinimum(tier, 'pro') ? '✅' : '❌');
    console.log('   Has Business access:', tierCheck.tierMeetsMinimum(tier, 'business') ? '✅' : '❌');
    console.log('   Has Enterprise access:', tierCheck.tierMeetsMinimum(tier, 'enterprise') ? '✅' : '❌');
    
    console.log('\n============================================');
    console.log('✅ Verification complete!');
    console.log('============================================\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('✓ Database connection closed');
  }
}

verifyComplaints();
