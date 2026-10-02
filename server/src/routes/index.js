'use strict';

/**
 * API v1 router assembly.
 *
 * Order matters: `/health` is unauthenticated, then the public auth routes,
 * then device provisioning, then devices, then telemetry.
 */

const express = require('express');
const { generalLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.use(generalLimiter);

router.use('/health', require('./health.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/provisioning', require('./provisioning.routes'));
router.use('/devices', require('./device.routes'));
router.use('/telemetry', require('./telemetry.routes'));

module.exports = router;
