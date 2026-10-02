const express = require('express');
const { auth } = require('../middleware/auth');
const Notification = require('../models/Notification');

const router = express.Router();

function buildUserQuery(user) {
  if (user.role === 'admin') {
    return {};
  }

  if (!user.shopId) {
    return { _id: null };
  }

  return {
    shopId: user.shopId
  };
}

function serializeNotification(notification, userId) {
  const {
    readBy = [],
    ...rest
  } = notification;

  return {
    ...rest,
    isRead: readBy.some(
      id => String(id) === String(userId)
    )
  };
}

/**
 * GET /api/notifications
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit, 10) || 20,
        1
      ),
      50
    );

    const query = buildUserQuery(req.user);

    const notifications =
      await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    const unreadCount =
      await Notification.countDocuments({
        ...query,
        readBy: {
          $ne: req.user._id
        }
      });

    res.json({
      notifications: notifications.map(
        notification =>
          serializeNotification(
            notification,
            req.user._id
          )
      ),
      unreadCount
    });
  } catch (error) {
    next(error);
  }
});


/**
 * PATCH /api/notifications/read-all
 */
router.patch(
  '/read-all',
  auth,
  async (req, res, next) => {
    try {
      const query = buildUserQuery(req.user);

      await Notification.updateMany(
        {
          ...query,
          readBy: {
            $ne: req.user._id
          }
        },
        {
          $addToSet: {
            readBy: req.user._id
          }
        }
      );

      res.json({
        success: true,
        unreadCount: 0
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * PATCH /api/notifications/:id/read
 */
router.patch(
  '/:id/read',
  auth,
  async (req, res, next) => {
    try {
      const query = buildUserQuery(req.user);

      const notification =
        await Notification.findOneAndUpdate(
          {
            ...query,
            _id: req.params.id
          },
          {
            $addToSet: {
              readBy: req.user._id
            }
          },
          {
            new: true
          }
        ).lean();

      if (!notification) {
        return res.status(404).json({
          error: 'Notification not found'
        });
      }

      res.json({
        notification:
          serializeNotification(
            notification,
            req.user._id
          )
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
