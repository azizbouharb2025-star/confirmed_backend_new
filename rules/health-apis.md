# Health Check APIs

Base URL: `http://localhost:3000/health`

## Overview
Health check APIs provide system monitoring, service status verification, and operational health insights for the Confirmed platform. These endpoints are essential for monitoring, load balancing, and deployment automation.

## Authentication
Health check endpoints are publicly accessible and do not require authentication for basic monitoring.

## Endpoints

### 1. Basic Health Check
**GET** `/`

Provides basic system health status and uptime information.

**Authentication:** None required

**Response (200):**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "uptime": 86400,
  "environment": "production",
  "version": "1.0.0",
  "nodeVersion": "18.20.8"
}
```

**Response Fields:**
- **status**: Overall system status (OK, DEGRADED, ERROR)
- **timestamp**: Current server timestamp
- **uptime**: Server uptime in seconds
- **environment**: Current environment (development, staging, production)
- **version**: Application version
- **nodeVersion**: Node.js version

**Use Cases:**
- **Load Balancer**: Quick health verification
- **Monitoring Tools**: Basic availability checking
- **Uptime Monitoring**: Service availability tracking

**Error Responses:**
- `503`: Service unavailable (rare, indicates critical system failure)

---

### 2. Detailed Health Check
**GET** `/detailed`

Provides comprehensive health status including all service dependencies.

**Authentication:** None required

**Response (200) - Healthy System:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "services": {
    "mongodb": {
      "status": "connected",
      "state": 1,
      "responseTime": 5,
      "collections": 8,
      "indexes": 25
    },
    "redis": {
      "status": "connected",
      "response": "PONG",
      "responseTime": 2,
      "memory": {
        "used": "15.2MB",
        "peak": "18.5MB"
      },
      "connections": 12
    },
    "queue": {
      "status": "active",
      "waiting": 15,
      "active": 3,
      "completed": 1250,
      "failed": 8,
      "paused": false
    }
  },
  "systemMetrics": {
    "memory": {
      "used": "245MB",
      "total": "512MB",
      "percentage": 47.8
    },
    "cpu": {
      "usage": 12.5,
      "loadAverage": [0.8, 0.9, 1.1]
    },
    "disk": {
      "used": "2.1GB",
      "total": "10GB",
      "percentage": 21.0
    }
  },
  "performance": {
    "averageResponseTime": 125,
    "requestsPerMinute": 450,
    "errorRate": 0.02
  }
}
```

**Response (503) - Degraded System:**
```json
{
  "status": "DEGRADED",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "services": {
    "mongodb": {
      "status": "connected",
      "state": 1,
      "responseTime": 5
    },
    "redis": {
      "status": "disconnected",
      "error": "Connection timeout",
      "lastConnected": "2024-01-01T10:25:00.000Z"
    },
    "queue": {
      "status": "degraded",
      "waiting": 150,
      "active": 0,
      "completed": 1250,
      "failed": 25,
      "paused": true
    }
  },
  "issues": [
    {
      "service": "redis",
      "severity": "high",
      "message": "Redis connection lost",
      "since": "2024-01-01T10:25:00.000Z"
    },
    {
      "service": "queue",
      "severity": "medium",
      "message": "Queue processing paused due to Redis issues",
      "since": "2024-01-01T10:25:00.000Z"
    }
  ]
}
```

**Service Status Values:**
- **connected**: Service is healthy and responsive
- **disconnected**: Service is not reachable
- **degraded**: Service is partially functional
- **error**: Service has critical errors

**MongoDB States:**
- **0**: Disconnected
- **1**: Connected
- **2**: Connecting
- **3**: Disconnecting

**Error Responses:**
- `503`: One or more critical services are unhealthy

---

### 3. Readiness Probe
**GET** `/ready`

Kubernetes-style readiness probe to determine if the service is ready to accept traffic.

**Authentication:** None required

**Response (200) - Ready:**
```json
{
  "status": "ready",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "checks": {
    "database": "ready",
    "cache": "ready",
    "queue": "ready"
  },
  "readyTime": "2024-01-01T10:00:00.000Z"
}
```

**Response (503) - Not Ready:**
```json
{
  "status": "not ready",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "checks": {
    "database": "ready",
    "cache": "not ready",
    "queue": "not ready"
  },
  "error": "Cache and queue services not available",
  "retryAfter": 30
}
```

**Readiness Criteria:**
- **Database**: MongoDB connection established
- **Cache**: Redis connection active
- **Queue**: Queue system operational
- **Configuration**: All required environment variables set

**Use Cases:**
- **Kubernetes**: Readiness probe for pod management
- **Load Balancer**: Traffic routing decisions
- **Deployment**: Verify service readiness after deployment

**Error Responses:**
- `503`: Service not ready to accept traffic

---

### 4. Liveness Probe
**GET** `/live`

Kubernetes-style liveness probe to determine if the service is alive and should be restarted.

**Authentication:** None required

**Response (200):**
```json
{
  "status": "alive",
  "timestamp": "2024-01-01T10:30:00.000Z",
  "pid": 12345,
  "uptime": 86400,
  "memoryUsage": {
    "rss": "245MB",
    "heapUsed": "180MB",
    "heapTotal": "220MB",
    "external": "25MB"
  }
}
```

**Liveness Criteria:**
- **Process**: Application process is running
- **Memory**: Memory usage within acceptable limits
- **Event Loop**: Event loop is not blocked
- **Critical Errors**: No unrecoverable errors

**Use Cases:**
- **Kubernetes**: Liveness probe for pod restart decisions
- **Process Monitoring**: Detect hung or crashed processes
- **Health Monitoring**: Continuous service monitoring

**Error Responses:**
- `503`: Service is not alive (very rare, indicates critical failure)

## Monitoring Integration

### Prometheus Metrics
Health endpoints can be integrated with Prometheus for metrics collection:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'confirmed-backend'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/health/detailed'
    scrape_interval: 30s
```

### Grafana Dashboard
Create dashboards using health check data:
- **Service Status**: Visual indicators for each service
- **Response Times**: Service response time graphs
- **Error Rates**: Error rate monitoring
- **Resource Usage**: Memory, CPU, and disk usage

### Alerting Rules
Set up alerts based on health check responses:
```yaml
# alerting.yml
groups:
  - name: confirmed-backend
    rules:
      - alert: ServiceDown
        expr: up{job="confirmed-backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Confirmed Backend is down"
          
      - alert: DatabaseDisconnected
        expr: confirmed_mongodb_status != 1
        for: 30s
        labels:
          severity: high
        annotations:
          summary: "MongoDB connection lost"
```

## Load Balancer Configuration

### HAProxy Example
```haproxy
# haproxy.cfg
backend confirmed-backend
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200
    server app1 localhost:3001 check
    server app2 localhost:3002 check
    server app3 localhost:3003 check
```

### NGINX Example
```nginx
# nginx.conf
upstream backend {
    server localhost:3001;
    server localhost:3002;
    server localhost:3003;
}

location /health {
    access_log off;
    return 200 "healthy\n";
    add_header Content-Type text/plain;
}
```

## Kubernetes Integration

### Deployment Configuration
```yaml
# deployment.yaml
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
      - name: backend
        image: confirmed-backend:latest
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
```

### Service Configuration
```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: confirmed-backend-service
spec:
  selector:
    app: confirmed-backend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: LoadBalancer
```

## Performance Considerations

### Response Time Optimization
- **Caching**: Cache health check results for frequently accessed endpoints
- **Async Checks**: Perform service checks asynchronously
- **Timeout Handling**: Set appropriate timeouts for service checks
- **Circuit Breaker**: Implement circuit breaker pattern for failing services

### Resource Usage
- **Lightweight Checks**: Keep health checks lightweight and fast
- **Minimal Logging**: Reduce logging for health check endpoints
- **Connection Pooling**: Reuse database connections for health checks
- **Memory Management**: Monitor memory usage during health checks

## Security Considerations

### Access Control
- **Internal Networks**: Restrict detailed health checks to internal networks
- **Rate Limiting**: Implement rate limiting for health check endpoints
- **Information Disclosure**: Avoid exposing sensitive information in health responses
- **Authentication**: Consider authentication for detailed health endpoints in production

### Monitoring Security
- **Log Analysis**: Monitor health check access patterns
- **Anomaly Detection**: Detect unusual health check request patterns
- **IP Whitelisting**: Whitelist monitoring system IPs
- **Encryption**: Use HTTPS for health check endpoints in production

## Troubleshooting

### Common Issues
- **Database Connection**: Check MongoDB connection string and credentials
- **Redis Connection**: Verify Redis server status and network connectivity
- **Queue Issues**: Check Redis connection and queue configuration
- **Memory Leaks**: Monitor memory usage trends
- **High CPU**: Investigate CPU-intensive operations

### Debug Information
Health checks provide debug information for troubleshooting:
- **Connection States**: Database and cache connection status
- **Error Messages**: Detailed error information
- **Performance Metrics**: Response times and resource usage
- **Service Dependencies**: Status of all dependent services