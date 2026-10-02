'use strict';

const provisioningService = require('../services/provisioning.service');
const asyncHandler = require('../utils/asyncHandler');
const { created, ok } = require('../utils/response');

/** POST /provisioning/register - device announces itself and gets a one-time token. */
const register = asyncHandler(async (req, res) => {
  const result = await provisioningService.register(req.body);
  return created(res, result);
});

/** POST /provisioning/exchange - token -> deviceId + deviceSecret (shown once). */
const exchange = asyncHandler(async (req, res) => {
  const result = await provisioningService.exchange(req.body);
  return created(res, result);
});

/**
 * POST /provisioning/heartbeat - signed liveness + runtime metadata.
 * `req.device` is attached by the HMAC middleware.
 */
const heartbeat = asyncHandler(async (req, res) => {
  const result = await provisioningService.heartbeat(req.device, req.body);
  return ok(res, result);
});

module.exports = { register, exchange, heartbeat };
