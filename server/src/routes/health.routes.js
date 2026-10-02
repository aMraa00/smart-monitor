'use strict';

const express = require('express');
const mongoose = require('mongoose');
const config = require('../config');
const emitter = require('../socket/emitter');
const { CAPABILITY_NAMES } = require('../utils/capabilities');

const router = express.Router();

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * GET /health - liveness + readiness in one payload.
 * Suitable for a load balancer or an uptime monitor.
 */
router.get('/', (req, res) => {
  const dbState = READY_STATES[mongoose.connection.readyState] || 'unknown';
  const healthy = dbState === 'connected';

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'ok' : 'degraded',
      uptimeS: Math.round(process.uptime()),
      version: '1.0.0',
      env: config.env,
      database: dbState,
      realtime: emitter.isReady(),
      capabilities: CAPABILITY_NAMES.length,
      serverTime: new Date().toISOString(),
    },
  });
});

/** GET /health/capabilities - the capability registry (handy for the dashboard). */
router.get('/capabilities', (_req, res) => {
  res.json({ success: true, data: CAPABILITY_NAMES });
});

module.exports = router;
