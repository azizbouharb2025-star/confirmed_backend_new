const express = require('express');
const ShopWallet = require('../models/ShopWallet');
const ShopWalletTransaction = require('../models/ShopWalletTransaction');
const { auth } = require('../middleware/auth');

const router = express.Router();

function ensureShopOwner(req, res) {
  if (req.user.role !== 'shop_owner') {
    res.status(403).json({
      error: 'Wallet access is restricted to shop owners'
    });
    return false;
  }

  if (!req.user.shopId) {
    res.status(400).json({
      error: 'No shop is associated with this account'
    });
    return false;
  }

  return true;
}

async function getOrCreateWallet(shopId) {
  return ShopWallet.findOneAndUpdate(
    { shopId },
    {
      $setOnInsert: {
        shopId,
        availableBalance: 0,
        pendingBalance: 0,
        currency: 'TND'
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );
}

/**
 * GET /api/wallet
 * Return the authenticated shop owner's wallet.
 */
router.get('/', auth, async (req, res, next) => {
  try {
    if (!ensureShopOwner(req, res)) return;

    const wallet = await getOrCreateWallet(req.user.shopId);

    res.json({
      wallet: {
        id: wallet._id,
        shopId: wallet.shopId,
        availableBalance: wallet.availableBalance,
        pendingBalance: wallet.pendingBalance,
        currency: wallet.currency,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/wallet/transactions
 * Return wallet transaction history for the authenticated shop.
 */
router.get('/transactions', auth, async (req, res, next) => {
  try {
    if (!ensureShopOwner(req, res)) return;

    const wallet = await getOrCreateWallet(req.user.shopId);

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;

    const requestedPage = Number.parseInt(req.query.page, 10);
    const page = Number.isFinite(requestedPage)
      ? Math.max(requestedPage, 1)
      : 1;

    const query = {
      shopId: req.user.shopId,
      walletId: wallet._id
    };

    if (
      typeof req.query.type === 'string' &&
      ['credit', 'debit', 'adjustment', 'refund'].includes(req.query.type)
    ) {
      query.type = req.query.type;
    }

    if (
      typeof req.query.status === 'string' &&
      ['pending', 'completed', 'cancelled'].includes(req.query.status)
    ) {
      query.status = req.query.status;
    }

    const [transactions, total] = await Promise.all([
      ShopWalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ShopWalletTransaction.countDocuments(query)
    ]);

    res.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
