'use strict';

const express = require('express');
const controller = require('../controllers/provisioning.controller');
const validate = require('../middleware/validate.middleware');
const { provisioningLimiter, deviceLimiter } = require('../middleware/rateLimit.middleware');
const { authenticateDevice } = require('../middleware/deviceAuth.middleware');
const {
  registerSchema,
  exchangeSchema,
  heartbeatSchema,
} = require('../validators/provisioning.validator');

const router = express.Router();

// Unauthenticated (rate limited): the device has no credentials yet.
router.post('/register', provisioningLimiter, validate({ body: registerSchema }), controller.register);
router.post('/exchange', provisioningLimiter, validate({ body: exchangeSchema }), controller.exchange);

// Authenticated via HMAC: the device already holds its secret.
router.post(
  '/heartbeat',
  deviceLimiter,
  authenticateDevice,
  validate({ body: heartbeatSchema }),
  controller.heartbeat
);

module.exports = router;
