'use strict';

const telemetryService = require('../services/telemetry.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const { accepted, ok } = require('../utils/response');

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

/**
 * POST /telemetry  (HMAC-signed device request)
 *
 * 202 means the batch is DURABLY accepted; the device may now erase the
 * corresponding MicroSD records (FR-D8).
 */
const ingest = asyncHandler(async (req, res) => {
  const result = await telemetryService.ingest(req.device, req.body);
  return accepted(res, result);
});

/** GET /telemetry/:deviceId */
const history = asyncHandler(async (req, res) => {
  const to = req.query.to || new Date();
  const from = req.query.from || new Date(to.getTime() - DEFAULT_RANGE_MS);

  if (from.getTime() >= to.getTime()) {
    throw ApiError.badRequest('TELEMETRY_RANGE', '`from` must be earlier than `to`');
  }

  const result = await telemetryService.query(req.device._id, {
    from,
    to,
    capability: req.query.capability,
    bucket: req.query.bucket,
    limit: req.query.limit,
  });

  return ok(res, result);
});

/** GET /telemetry/:deviceId/latest */
const latest = asyncHandler(async (req, res) => {
  const snapshot = await telemetryService.latest(req.device._id);
  if (!snapshot) throw ApiError.notFound('TELEMETRY_EMPTY', 'No telemetry received yet');
  return ok(res, snapshot);
});

module.exports = { ingest, history, latest };
