# Quick Start Guide

## Development Setup

1. **Install dependencies**
```bash
cd backend
npm install
```

2. **Environment setup**
```bash
cp .env.example .env
# Edit .env with your database URLs
```

3. **Start services**
```bash
# Option 1: Docker (Recommended)
docker-compose up -d

# Option 2: Local services
# Start MongoDB and Redis locally, then:
npm run dev
```

4. **Access**
- API: http://localhost:3000
- Health: http://localhost:3000/health
- Docs: http://localhost:3000/api-docs

## Production Deployment

```bash
# Docker Production
npm run deploy

# PM2 Production
npm run prod

# Kubernetes
kubectl apply -f k8s/
```

## Essential Endpoints

- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login
- `POST /api/orders` - Create order
- `GET /api/operators/next-order` - Get next order
- `GET /health` - Health check