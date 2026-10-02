'use strict';

const express = require('express');
const controller = require('../controllers/telemetry.controller');
const validate = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { authenticateDevice } = require('../middleware/deviceAuth.middleware');
const { loadOwnedDevice } = require('../middleware/ownership.middleware');
const { deviceLimiter } = require('../middleware/rateLimit.middleware');
const { ingestSchema, querySchema } = require('../validators/telemetry.validator');
const { deviceId: deviceIdSchema } = require('../validators/common');
const { z } = require('zod');

const router = express.Router();

/**
 * WRITE path: only HMAC-authenticated devices may submit telemetry.
 * A user JWT can never post here (separation of device vs user trust).
 */
router.post(
  '/',
  deviceLimiter,
  authenticateDevice,
  validate({ body: ingestSchema }),
  controller.ingest
);

/** READ paths: only the owner (or admin) may read a device's history. */
router.get(
  '/:deviceId/latest',
  authenticate,
  validate({ params: z.object({ deviceId: deviceIdSchema }) }),
  loadOwnedDevice,
  controller.latest
);

router.get(
  '/:deviceId',
  authenticate,
  validate({ params: z.object({ deviceId: deviceIdSchema }), query: querySchema }),
  loadOwnedDevice,
  controller.history
);

module.exports = router;
