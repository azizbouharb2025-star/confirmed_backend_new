const axios = require('axios');
const DeliveryIntegration = require('../models/DeliveryIntegration');
const Order = require('../models/Order');
const logger = require('../utils/logger');

class DeliveryService {
  async createAramexShipment(orderId) {
    try {
      const order = await Order.findById(orderId).populate('shopId');
      const integration = await DeliveryIntegration.findOne({ 
        shopId: order.shopId._id, 
        platform: 'aramex' 
      });

      const shipmentData = {
        ClientInfo: {
          UserName: integration.credentials.username,
          Password: integration.credentials.password,
          Version: 'v1.0',
          AccountNumber: integration.credentials.accountNumber,
          AccountPin: integration.credentials.apiKey,
          AccountEntity: 'AMM',
          AccountCountryCode: 'JO'
        },
        Shipments: [{
          Reference1: order.orderId,
          Shipper: {
            Name: order.shopId.name,
            CellPhone: '+216XXXXXXXX'
          },
          Consignee: {
            Name: order.clientInfo.name,
            CellPhone: order.clientInfo.phone,
            EmailAddress: order.clientInfo.email
          },
          Details: {
            Dimensions: { Length: 10, Width: 10, Height: 10, Unit: 'CM' },
            ActualWeight: { Value: 1, Unit: 'KG' },
            ProductGroup: 'EXP',
            ProductType: 'PPX',
            PaymentType: 'P',
            PaymentOptions: 'CASH',
            Services: 'CODS',
            NumberOfPieces: 1,
            DescriptionOfGoods: 'Order Items',
            GoodsOriginCountry: 'TN'
          }
        }]
      };

      const response = await axios.post(
        `${integration.credentials.baseUrl}/ShippingAPI.V2/Shipping/Service_1_0.svc/json/CreateShipments`,
        shipmentData
      );

      if (response.data.HasErrors) {
        throw new Error(response.data.Notifications[0].Message);
      }

      const trackingNumber = response.data.Shipments[0].ID;
      await Order.findByIdAndUpdate(orderId, {
        'deliveryInfo.trackingNumber': trackingNumber,
        'deliveryInfo.carrier': 'Aramex'
      });

      return trackingNumber;
    } catch (error) {
      logger.error(`Failed to create Aramex shipment for order ${orderId}:`, error);
      throw error;
    }
  }

  async trackShipment(orderId) {
    try {
      const order = await Order.findById(orderId).populate('shopId');
      const integration = await DeliveryIntegration.findOne({ 
        shopId: order.shopId._id 
      });

      if (integration.platform === 'aramex') {
        return await this.trackAramexShipment(order.deliveryInfo.trackingNumber, integration);
      }
      
      throw new Error('Unsupported delivery platform');
    } catch (error) {
      logger.error(`Failed to track shipment for order ${orderId}:`, error);
      throw error;
    }
  }

  async trackAramexShipment(trackingNumber, integration) {
    const trackingData = {
      ClientInfo: {
        UserName: integration.credentials.username,
        Password: integration.credentials.password,
        Version: 'v1.0',
        AccountNumber: integration.credentials.accountNumber,
        AccountPin: integration.credentials.apiKey,
        AccountEntity: 'AMM',
        AccountCountryCode: 'JO'
      },
      GetLastTrackingUpdateOnly: false,
      Shipments: [trackingNumber]
    };

    const response = await axios.post(
      `${integration.credentials.baseUrl}/ShippingAPI.V2/Tracking/Service_1_0.svc/json/TrackShipments`,
      trackingData
    );

    return response.data.TrackingResults[0];
  }

  async setupDeliveryIntegration(shopId, platform, credentials, settings) {
    return await DeliveryIntegration.findOneAndUpdate(
      { shopId, platform },
      { credentials, settings, isActive: true },
      { upsert: true, new: true }
    );
  }
}

module.exports = new DeliveryService();