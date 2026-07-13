const path = require('path');
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const { connectRedis } = require('./config/redis');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const backgroundJobs = require('./jobs/backgroundJobs');
const { initSentry, sentryErrorHandler } = require('./config/sentry');
const { setupSwagger } = require('./config/swagger');
const { httpsRedirect, sanitizeInput } = require('./middleware/security');
const { authenticateSocket } = require('./websocket/socketAuth');
const { setupOrderEvents } = require('./websocket/orderEvents');
const { setupDashboardEvents } = require('./websocket/dashboardEvents');
const { setupComplaintEvents } = require('./websocket/complaintEvents');

// Routes
const authRoutes = require('./routes/auth');
const shopRoutes = require('./routes/shops');
const orderRoutes = require('./routes/orders');
const operatorRoutes = require('./routes/operators');
const subscriptionRoutes = require('./routes/subscriptions');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');
const apiRoutes = require('./routes/api');
const analyticsRoutes = require('./routes/analytics');
const productRoutes = require('./routes/products');
const deliveryRoutes = require('./routes/delivery');
const integrationRoutes = require('./routes/integration');
const complaintRoutes = require('./routes/complaints');
const supportCardRoutes = require('./routes/supportCards');
const userRoutes = require('./routes/users');
const teamRoutes = require('./routes/team');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (nginx)
const server = http.createServer(app);

// Serve uploaded files (before other middleware to avoid blocking)
const uploadsPath = path.join(__dirname, '..', 'uploads');
console.log('Serving uploads from:', uploadsPath);
app.use('/uploads', express.static(uploadsPath));

// Debug route to check file existence (development only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug/uploads/*', (req, res) => {
    const fs = require('fs');
    const filePath = path.join(uploadsPath, req.params[0]);
    res.json({
      requestedPath: req.params[0],
      fullPath: filePath,
      exists: fs.existsSync(filePath),
      uploadsDir: fs.existsSync(uploadsPath),
      uploadsContents: fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath) : []
    });
  });
}

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:8000', 
      'http://127.0.0.1:8000', 
      'http://localhost:3001',
      'https://confirmed.tn',
      'https://www.confirmed.tn',
      'https://api.confirmed.tn'
    ],
    credentials: true,
    methods: ['GET', 'POST']
  }
});

// Apply WebSocket authentication middleware
io.use(authenticateSocket);

// Setup WebSocket event handlers
setupOrderEvents(io);
setupDashboardEvents(io);
setupComplaintEvents(io);

// Export io instance for use in other modules
app.set('io', io);

// Initialize Sentry
initSentry(app);

// Security middleware
app.use(httpsRedirect);
app.use(helmet());

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:8000', 
  'http://127.0.0.1:8000', 
  'http://localhost:3001',
  'https://confirmed.tn',
  'https://www.confirmed.tn',
  'https://api.confirmed.tn'
];

// Explicit preflight handler — ensures OPTIONS responses always include CORS headers
// even when behind Cloudflare or other proxies that may strip them
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.sendStatus(204);
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(sanitizeInput);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500 // limit each IP to 500 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };
    
    // Add user info if authenticated
    if (req.user) {
      logData.userId = req.user._id;
      logData.userRole = req.user.role;
    }
    
    // Log level based on status code
    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });
  
  next();
});

// Setup Swagger
setupSwagger(app);

// Health checks
app.use('/health', require('./routes/health'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/external-api', apiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/integration', integrationRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/support-cards', supportCardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/team', teamRoutes);



// Error handling
app.use(sentryErrorHandler());
app.use(errorHandler);

const PORT = process.env.PORT || 8000;

async function startServer() {
  try {
    await connectDB();
    await connectRedis();
    backgroundJobs.start();
    
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on 0.0.0.0:${PORT}`);
      logger.info('WebSocket server initialized');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close WebSocket connections
      io.close(() => {
        logger.info('WebSocket server closed');
      });
      
      // Close Redis connection
      const redis = require('./config/redis').getRedisClient();
      if (redis) {
        await redis.quit();
        logger.info('Redis connection closed');
      }
      
      // Close MongoDB connection
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export app as default for backward compatibility with tests
// Also export server and io for WebSocket functionality
module.exports = app;
module.exports.app = app;
module.exports.server = server;
module.exports.io = io;