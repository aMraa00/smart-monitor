'use strict';

/**
 * Rate limiting (threats T5, T14).
 *
 * Several limiters are exposed because the traffic classes differ:
 *  - general      : every API call, keyed by IP
 *  - auth         : login/register, tighter (brute force)
 *  - provisioning : device registration, tighter (unauthenticated write)
 *  - device       : telemetry/heartbeat, keyed by X-Device-Id so one faulty
 *                   firmware cannot exhaust the quota of every other device
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

/** Shared handler so clients receive the standard error envelope. */
function limitHandler(req, res) {
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    },
    requestId: req.id,
  });
}

const base = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
  // Tests must not be perturbed by accumulated counters.
  skip: () => config.isTest,
};

const generalLimiter = rateLimit({ ...base, limit: config.rateLimit.max });

const authLimiter = rateLimit({
  ...base,
  limit: 20,
  keyGenerator: (req) => `${req.ip}:${(req.body && req.body.email) || ''}`,
});

const provisioningLimiter = rateLimit({ ...base, limit: 30 });

const deviceLimiter = rateLimit({
  ...base,
  limit: 240, // 4 requests/second average per device - generous for buffered drains
  keyGenerator: (req) => req.get('x-device-id') || req.ip,
});

module.exports = { generalLimiter, authLimiter, provisioningLimiter, deviceLimiter };
