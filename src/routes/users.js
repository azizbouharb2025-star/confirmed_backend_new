const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

/**
 * GET /api/users/preferences
 */
router.get('/preferences', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('preferences').lean();
    res.json({
      emailNotifications: user.preferences?.emailNotifications ?? true,
      pushNotifications: user.preferences?.pushNotifications ?? true
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT or PATCH /api/users/preferences
 */
const updatePreferences = async (req, res, next) => {
  try {
    const { emailNotifications, pushNotifications } = req.body;
    const update = {};
    if (typeof emailNotifications === 'boolean') update['preferences.emailNotifications'] = emailNotifications;
    if (typeof pushNotifications === 'boolean') update['preferences.pushNotifications'] = pushNotifications;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid preference fields provided' });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: update });

    const user = await User.findById(req.user._id).select('preferences').lean();
    res.json({
      emailNotifications: user.preferences?.emailNotifications ?? true,
      pushNotifications: user.preferences?.pushNotifications ?? true
    });
  } catch (error) {
    next(error);
  }
};
router.put('/preferences', auth, updatePreferences);
router.patch('/preferences', auth, updatePreferences);

module.exports = router;
