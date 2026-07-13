# Confirmed Backend API Documentation

## Overview
This directory contains comprehensive documentation for all APIs in the Confirmed AI-driven order confirmation platform. The system provides a complete solution for e-commerce order management, operator workflows, and business analytics.

## API Categories

### 🔐 [Authentication APIs](./authentication-apis.md)
User registration, login, and JWT-based authentication system.
- **Base URL**: `/api/auth`
- **Features**: Multi-role authentication, secure password handling, JWT tokens
- **Roles**: `shop_owner`, `operator`, `admin`

### 🏪 [Shops APIs](./shops-apis.md)
E-commerce store management and platform integrations.
- **Base URL**: `/api/shops`
- **Features**: Shopify/WooCommerce integration, shop settings, subscription management
- **Platforms**: Shopify, WooCommerce, Custom

### 📦 [Orders APIs](./orders-apis.md)
Order creation, management, and status tracking.
- **Base URL**: `/api/orders`
- **Features**: Order queue management, status updates, operator assignment
- **Integration**: Redis queue system, call history tracking

### 👥 [Operators APIs](./operators-apis.md)
Call center operator workflows and performance tracking.
- **Base URL**: `/api/operators`
- **Features**: Order assignment, performance statistics, queue management
- **Metrics**: Confirmation rates, call efficiency, operator rankings

### 👑 [Admin APIs](./admin-apis.md)
System administration and user management.
- **Base URL**: `/api/admin`
- **Features**: Dashboard analytics, user management, system monitoring
- **Access**: Admin-only endpoints with comprehensive system insights

### 📊 [Analytics APIs](./analytics-apis.md)
Business intelligence and performance analytics.
- **Base URL**: `/api/analytics`
- **Features**: Dashboard metrics, call efficiency, revenue analytics
- **Insights**: Performance trends, operator analytics, business metrics

### 🛍️ [Products APIs](./products-apis.md)
Product catalog management and platform synchronization.
- **Base URL**: `/api/products`
- **Features**: Product sync, manual product management, inventory tracking
- **Integration**: Shopify/WooCommerce product synchronization

### 💳 [Subscriptions APIs](./subscriptions-apis.md)
Billing and subscription management with Stripe integration.
- **Base URL**: `/api/subscriptions`
- **Features**: Plan management, payment processing, feature limits
- **Plans**: Free, Premium, Enterprise

### 🚚 [Delivery APIs](./delivery-apis.md)
Shipping and logistics management.
- **Base URL**: `/api/delivery`
- **Features**: Aramex integration, shipment tracking, delivery management
- **Carriers**: Aramex (with extensible architecture)

### 🔗 [Webhooks APIs](./webhooks-apis.md)
Real-time event handling and external integrations.
- **Base URL**: `/api/webhooks`
- **Features**: Shopify webhooks, order status updates, event processing
- **Security**: Signature verification, replay protection

### 🌐 [External APIs](./external-apis.md)
Third-party integration endpoints with API key authentication.
- **Base URL**: `/external-api`
- **Features**: Server-to-server communication, product enrichment, rate limiting
- **Authentication**: API key-based authentication

### ❤️ [Health Check APIs](./health-apis.md)
System monitoring and service health verification.
- **Base URL**: `/health`
- **Features**: Service status, readiness/liveness probes, system metrics
- **Integration**: Kubernetes, load balancers, monitoring tools

## Quick Start

### 1. Authentication Flow
```bash
# Register a shop owner
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"shop@example.com","password":"password123","name":"Shop Owner","role":"shop_owner"}'

# Login and get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"shop@example.com","password":"password123"}'
```

### 2. Create Shop
```bash
# Create a shop (requires JWT token)
curl -X POST http://localhost:3000/api/shops \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Store","domain":"mystore.com","platform":"shopify"}'
```

### 3. Create Order
```bash
# Create an order
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"ORDER-001","clientInfo":{"name":"John Doe","phone":"+1234567890"},"items":[{"name":"Product","quantity":1,"price":99.99}],"totalAmount":99.99}'
```

## System Architecture

### Core Components
- **Express.js**: Web framework and API server
- **MongoDB**: Primary database with proper indexing
- **Redis**: Queue management and caching
- **JWT**: Authentication and authorization
- **Stripe**: Payment processing and subscriptions

### External Integrations
- **Shopify**: E-commerce platform integration
- **WooCommerce**: WordPress e-commerce integration
- **Aramex**: Shipping and logistics
- **Sentry**: Error tracking and monitoring

### Security Features
- **JWT Authentication**: Secure token-based authentication
- **Role-based Access Control**: Granular permission system
- **API Key Authentication**: Secure external API access
- **Rate Limiting**: Prevent abuse and ensure fair usage
- **Input Validation**: Comprehensive request validation
- **HTTPS Encryption**: Secure data transmission

## Environment Setup

### Required Environment Variables
```bash
# Database
MONGODB_URI=mongodb://localhost:27017/confirmed
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=24h

# Stripe (for subscriptions)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# External Services
SENTRY_DSN=https://...
NODE_ENV=development
PORT=3000
```

### Docker Setup
```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f app
```

## API Testing

### Postman Collection
Import the provided Postman collection for comprehensive API testing:
- **File**: `Confirmed_API.postman_collection.json`
- **Base URL**: `http://localhost:3000`
- **Authentication**: Automatic token management

### Test Scenarios
1. **User Registration & Authentication**
2. **Shop Creation & Configuration**
3. **Order Management Workflow**
4. **Operator Assignment & Processing**
5. **Analytics & Reporting**
6. **Subscription Management**
7. **Product Synchronization**
8. **Webhook Processing**

## Rate Limits

### Default Limits
- **Authenticated APIs**: 100 requests/minute
- **External APIs**: 100 requests/minute per API key
- **Health Checks**: No limits
- **Webhooks**: 1000 requests/minute

### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Error Handling

### Standard Error Format
```json
{
  "error": "Error type",
  "message": "Human readable message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T10:30:00.000Z"
}
```

### Common HTTP Status Codes
- **200**: Success
- **201**: Created
- **400**: Bad Request
- **401**: Unauthorized
- **403**: Forbidden
- **404**: Not Found
- **429**: Too Many Requests
- **500**: Internal Server Error
- **503**: Service Unavailable

## Monitoring & Observability

### Health Checks
- **Basic**: `/health` - Simple status check
- **Detailed**: `/health/detailed` - Comprehensive service status
- **Readiness**: `/health/ready` - Kubernetes readiness probe
- **Liveness**: `/health/live` - Kubernetes liveness probe

### Metrics & Analytics
- **System Metrics**: CPU, memory, disk usage
- **Application Metrics**: Request rates, response times, error rates
- **Business Metrics**: Orders processed, confirmation rates, revenue
- **Performance Metrics**: Database query times, queue lengths

### Logging
- **Structured Logging**: JSON format with Winston
- **Log Levels**: Error, warn, info, debug
- **Request Logging**: All API requests logged
- **Error Tracking**: Integration with Sentry

## Development Guidelines

### API Design Principles
- **RESTful**: Follow REST conventions
- **Consistent**: Uniform response formats
- **Secure**: Authentication and validation
- **Documented**: Comprehensive documentation
- **Tested**: Unit and integration tests

### Code Standards
- **ESLint**: Code linting and formatting
- **Error Handling**: Proper error handling and logging
- **Validation**: Input validation with Joi
- **Security**: Security best practices
- **Performance**: Optimized database queries

## Support & Resources

### Documentation
- **API Reference**: Detailed endpoint documentation
- **Integration Guides**: Platform integration guides
- **Troubleshooting**: Common issues and solutions
- **Best Practices**: Development and deployment guidelines

### Community
- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: Community discussions and Q&A
- **Contributing**: Contribution guidelines
- **Changelog**: Version history and updates

---

**Last Updated**: January 2024  
**Version**: 1.0.0  
**Node.js**: 18.20.8  
**Database**: MongoDB 7.0+  
**Cache**: Redis 7.0+