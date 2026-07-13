const Joi = require('joi');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }
    next();
  };
};

const schemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().required(),
    role: Joi.string().valid('shop_owner', 'operator').required()
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  createShop: Joi.object({
    name: Joi.string().required(),
    domain: Joi.string().required(),
    platform: Joi.string().valid('shopify', 'woocommerce', 'custom').required(),
    apiCredentials: Joi.object({
      apiKey: Joi.string(),
      apiSecret: Joi.string(),
      accessToken: Joi.string()
    })
  }),

  createOrder: Joi.object({
    orderId: Joi.string().required(),
    clientInfo: Joi.object({
      name: Joi.string().required(),
      phone: Joi.string().required(),
      email: Joi.string().email()
    }).required(),
    items: Joi.array().items(Joi.object({
      name: Joi.string(),
      quantity: Joi.number(),
      price: Joi.number()
    })),
    totalAmount: Joi.number().required()
  }),

  updateOrderStatus: Joi.object({
    status: Joi.string().valid('pending', 'confirmed', 'called', 'delivered', 'cancelled').required(),
    notes: Joi.string()
  })
};

module.exports = { validate, schemas };