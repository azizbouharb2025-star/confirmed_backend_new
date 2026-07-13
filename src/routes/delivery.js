const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const deliveryService = require('../services/deliveryService');
const DeliveryIntegration = require('../models/DeliveryIntegration');
const Order = require('../models/Order');

// Helper to verify order belongs to user's shop
const verifyOrderOwnership = async (orderId, user) => {
  const order = await Order.findById(orderId);
  if (!order) return { valid: false, error: 'Order not found', status: 404 };
  
  if (user.role !== 'admin' && order.shopId.toString() !== user.shopId?.toString()) {
    return { valid: false, error: 'Access denied', status: 403 };
  }
  return { valid: true, order };
};

// Setup delivery integration
router.post('/integration', auth, async (req, res, next) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'No shop associated with user' });
    }
    
    const { platform, credentials, settings } = req.body;
    const integration = await deliveryService.setupDeliveryIntegration(
      req.user.shopId,
      platform,
      credentials,
      settings
    );
    res.status(201).json(integration);
  } catch (error) {
    next(error);
  }
});

// Get delivery integrations
router.get('/integrations', auth, async (req, res, next) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'No shop associated with user' });
    }
    
    const integrations = await DeliveryIntegration.find({ shopId: req.user.shopId });
    res.json(integrations);
  } catch (error) {
    next(error);
  }
});

// Create shipment
router.post('/shipment/:orderId', auth, async (req, res, next) => {
  try {
    const ownership = await verifyOrderOwnership(req.params.orderId, req.user);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }
    
    const trackingNumber = await deliveryService.createAramexShipment(req.params.orderId);
    res.json({ trackingNumber });
  } catch (error) {
    next(error);
  }
});

// Track shipment
router.get('/track/:orderId', auth, async (req, res, next) => {
  try {
    const ownership = await verifyOrderOwnership(req.params.orderId, req.user);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }
    
    const trackingInfo = await deliveryService.trackShipment(req.params.orderId);
    res.json(trackingInfo);
  } catch (error) {
    next(error);
  }
});

module.exports = router;