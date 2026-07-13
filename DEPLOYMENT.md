# Deployment Guide

## Production Deployment

### Environment Setup
1. Set production environment variables
2. Configure MongoDB Atlas or self-hosted MongoDB
3. Set up Redis instance
4. Configure Stripe webhooks

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Scale services
docker-compose -f docker-compose.prod.yml up -d --scale app=3
```

### Kubernetes Deployment
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: confirmed-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: confirmed-backend
  template:
    metadata:
      labels:
        app: confirmed-backend
    spec:
      containers:
      - name: app
        image: confirmed-backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: mongodb-uri
```

### Monitoring & Logging
- Use Winston for structured logging
- Set up log aggregation (ELK stack)
- Monitor with Prometheus/Grafana
- Set up alerts for critical errors

### Security Checklist
- [ ] Enable HTTPS/TLS
- [ ] Set up firewall rules
- [ ] Configure rate limiting
- [ ] Enable CORS properly
- [ ] Secure environment variables
- [ ] Regular security updates