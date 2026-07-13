const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const limiters = require('../middleware/rateLimiter');

const router = express.Router();

// Apply rate limiting to auth routes
router.use(limiters.auth);

// Register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phoneNumber, whatsappNumber, isWhatsappLinked, country, role } = req.body;

    // Validate required fields with specific error messages
    const missingFields = [];
    if (!email) missingFields.push('email');
    if (!password) missingFields.push('password');
    if (!firstName) missingFields.push('firstName');
    if (!lastName) missingFields.push('lastName');
    if (!phoneNumber) missingFields.push('phoneNumber');
    if (!whatsappNumber) missingFields.push('whatsappNumber');
    if (isWhatsappLinked === undefined || isWhatsappLinked === null) missingFields.push('isWhatsappLinked');
    if (!country) missingFields.push('country');
    if (!role) missingFields.push('role');

    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    // Only allow shop_owner and operator roles during self-registration
    // Admin accounts must be created by existing admins
    const allowedRoles = ['shop_owner', 'operator'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Allowed: shop_owner, operator' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const user = new User({ email, password, firstName, lastName, phoneNumber, whatsappNumber, isWhatsappLinked, country, role });
    await user.save();

    // Log activity for admin feed
    const { logActivity } = require('../services/activityLogService');
    await logActivity('user', 'New user registered', email);

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
        isWhatsappLinked: user.isWhatsappLinked,
        country: user.country,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', async (req, res, next) => {
  try {


    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !await user.comparePassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
        isWhatsappLinked: user.isWhatsappLinked,
        country: user.country,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', auth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      phoneNumber: req.user.phoneNumber,
      whatsappNumber: req.user.whatsappNumber,
      isWhatsappLinked: req.user.isWhatsappLinked,
      country: req.user.country,
      role: req.user.role
    }
  });
});

// Update profile
router.patch('/profile', auth, async (req, res, next) => {
  try {
    const { firstName, lastName, phoneNumber, whatsappNumber, isWhatsappLinked } = req.body;

    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
    if (whatsappNumber !== undefined) updates.whatsappNumber = whatsappNumber;
    if (isWhatsappLinked !== undefined) updates.isWhatsappLinked = isWhatsappLinked;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });

    res.json({
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
        isWhatsappLinked: user.isWhatsappLinked,
        country: user.country,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// Change password
router.patch('/password', auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;