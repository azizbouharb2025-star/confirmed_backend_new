const jwt = require('jsonwebtoken');
const { getRedisClient } = require('../config/redis');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  
  return { accessToken, refreshToken };
};

const storeRefreshToken = async (userId, refreshToken) => {
  const redis = getRedisClient();
  await redis.setEx(`refresh_token:${userId}`, 7 * 24 * 60 * 60, refreshToken);
};

const validateRefreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }
    
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const redis = getRedisClient();
    const storedToken = await redis.get(`refresh_token:${decoded.id}`);
    
    if (storedToken !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    const tokens = generateTokens(decoded.id);
    await storeRefreshToken(decoded.id, tokens.refreshToken);
    
    res.json(tokens);
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

const revokeRefreshToken = async (userId) => {
  const redis = getRedisClient();
  await redis.del(`refresh_token:${userId}`);
};

module.exports = { generateTokens, storeRefreshToken, validateRefreshToken, revokeRefreshToken };