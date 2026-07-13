const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendEmail(to, subject, html) {
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_USER,
        to,
        subject,
        html
      });
      logger.info(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
      throw error;
    }
  }

  async notifyOrderStatus(order, shop) {
    const subject = `Order ${order.orderId} - Status Update`;
    const html = `
      <h2>Order Status Update</h2>
      <p>Order ID: ${order.orderId}</p>
      <p>Status: ${order.status}</p>
      <p>Customer: ${order.clientInfo.name}</p>
      <p>Total: $${order.totalAmount}</p>
    `;

    await this.sendEmail(shop.owner.email, subject, html);
  }

  async notifyFailedCall(order, shop) {
    const subject = `Failed Call - Order ${order.orderId}`;
    const html = `
      <h2>Call Failed</h2>
      <p>Unable to reach customer for order ${order.orderId}</p>
      <p>Customer: ${order.clientInfo.name}</p>
      <p>Phone: ${order.clientInfo.phone}</p>
      <p>Please review and take manual action.</p>
    `;

    await this.sendEmail(shop.owner.email, subject, html);
  }

  async sendWebhook(url, data) {
    try {
      await axios.post(url, data, {
        headers: { 'Content-Type': 'application/json' }
      });
      logger.info(`Webhook sent to ${url}`);
    } catch (error) {
      logger.error(`Webhook failed for ${url}:`, error);
    }
  }
}

module.exports = new NotificationService();