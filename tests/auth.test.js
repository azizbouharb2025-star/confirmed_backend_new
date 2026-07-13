const request = require('supertest');
const app = require('../src/server');
const User = require('../src/models/User');

describe('Auth Endpoints', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: '+21612345678',
        whatsappNumber: '+21612345678',
        isWhatsappLinked: true,
        country: 'Tunisia',
        role: 'shop_owner'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe(userData.email);
    });

    it('should not register user with missing required fields', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123'
        // Missing required fields: firstName, lastName, phoneNumber, etc.
      };

      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: '+21612345678',
        whatsappNumber: '+21612345678',
        isWhatsappLinked: true,
        country: 'Tunisia',
        role: 'shop_owner'
      });
      await user.save();
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
    });

    it('should not login with invalid credentials', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        })
        .expect(401);
    });
  });
});