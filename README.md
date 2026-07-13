# Confirmed Backend

Production-ready backend for the Confirmed AI-driven order confirmation platform.

## Features

- **Multi-tenant shop management** with API integrations
- **Intelligent order queue** with Redis-based distribution
- **JWT authentication** with role-based access control
- **Subscription management** with Stripe integration
- **Real-time webhooks** for external systems
- **Comprehensive logging** and error tracking
- **Docker containerization** for easy deployment

## Quick Start

1. Clone and navigate to the project:
```bash
git clone <repository-url>
cd backend
```

2. Environment variables are pre-configured in docker-compose.yml for development

3. Start with Docker (recommended):
```bash
docker-compose up -d
```

4. Verify services are running:
```bash
# Check health
curl http://localhost:3000/health

# Check logs
docker-compose logs -f app
```

5. Test API endpoints:
```bash
# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User","role":"shop_owner"}'
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders` - List orders
- `PATCH /api/orders/:id/status` - Update order status

### Operators
- `GET /api/operators/next-order` - Get next order from queue
- `GET /api/operators/stats` - Get operator statistics

### Admin
- `GET /api/admin/dashboard` - Analytics dashboard
- `GET /api/admin/users` - Manage users

## Architecture

- **Express.js** - Web framework
- **MongoDB** - Primary database with proper indexing
- **Redis** - Queue management and caching
- **JWT** - Authentication tokens
- **Stripe** - Payment processing
- **Winston** - Structured logging

## API Documentation

Comprehensive API documentation is available in the `/rules` directory:

- **[Complete API Overview](./rules/README.md)** - All endpoints and quick start
- **[Authentication APIs](./rules/authentication-apis.md)** - User management and JWT
- **[Orders APIs](./rules/orders-apis.md)** - Order processing and queue management
- **[Shops APIs](./rules/shops-apis.md)** - E-commerce platform integrations
- **[Analytics APIs](./rules/analytics-apis.md)** - Business intelligence and metrics
- **[Health Check APIs](./rules/health-apis.md)** - System monitoring

### Postman Collection
Import `Confirmed_API.postman_collection.json` for complete API testing.

## Troubleshooting

### Common Issues

**SSL/HTTPS Errors in Postman:**
- Use `http://localhost:3000` (not https)
- The app runs on HTTP in development mode

**JWT Secret Errors:**
- JWT secrets are configured in docker-compose.yml
- Restart containers if authentication fails

**Database Connection Issues:**
```bash
# Check if MongoDB is running
docker-compose ps

# View MongoDB logs
docker-compose logs mongo
```

**Redis Connection Issues:**
```bash
# Check Redis status
docker-compose logs redis

# Test Redis connection
docker-compose exec redis redis-cli ping
```

### Service Status
```bash
# Check all services
docker-compose ps

# View application logs
docker-compose logs -f app

# Restart specific service
docker-compose restart app
```

## Testing

```bash
npm test
```

## Deployment

The application is containerized and ready for production deployment with proper security, monitoring, and scalability features.

### Production Environment Variables
For production, update docker-compose.yml with:
- `NODE_ENV=production`
- Secure JWT secrets
- Production database URLs
- SSL certificates for HTTPS