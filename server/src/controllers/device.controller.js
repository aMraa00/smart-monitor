'use strict';

const deviceService = require('../services/device.service');
const alertService = require('../services/alert.service');
const asyncHandler = require('../utils/asyncHandler');
const emitter = require('../socket/emitter');
const ApiError = require('../utils/apiError');
const { ok, created, noContent } = require('../utils/response');

/** GET /devices */
const list = asyncHandler(async (req, res) => {
  const { items, meta } = await deviceService.listDevices(req.user, req.query);
  return ok(res, items, meta);
});

/** GET /devices/:deviceId */
const getOne = asyncHandler(async (req, res) => {
  // req.device was attached by the ownership middleware.
  return ok(res, req.device.toPublicJSON());
});

/** POST /devices/claim */
const claim = asyncHandler(async (req, res) => {
  const device = await deviceService.claimDevice(req.body, req.user);
  emitter.emitToUser(req.user._id, 'device:claimed', { deviceId: device.deviceId });
  return ok(res, device);
});

/** PATCH /devices/:deviceId */
const update = asyncHandler(async (req, res) => {
  const device = await deviceService.updateDevice(req.params.deviceId, req.user, req.body);
  emitter.emitToDeviceAndOwner(device.deviceId, req.user._id, 'device:updated', {
    deviceId: device.deviceId,
    displayName: device.displayName,
    locationName: device.locationName,
    config: device.config,
  });
  return ok(res, device);
});

/** POST /devices/:deviceId/rotate-secret */
const rotateSecret = asyncHandler(async (req, res) => {
  const result = await deviceService.rotateSecret(req.params.deviceId, req.user);
  return ok(res, result);
});

/** POST /devices/:deviceId/transfer */
const transfer = asyncHandler(async (req, res) => {
  const device = await deviceService.transferDevice(
    req.params.deviceId,
    req.user,
    req.body.toEmail
  );
  emitter.emitToUser(req.user._id, 'device:updated', { deviceId: device.deviceId });
  return ok(res, device);
});

/** POST /devices/:deviceId/revoke */
const revoke = asyncHandler(async (req, res) => {
  const device = await deviceService.revokeDevice(req.params.deviceId, req.user);
  return ok(res, device);
});

/** DELETE /devices/:deviceId */
const remove = asyncHandler(async (req, res) => {
  await deviceService.deleteDevice(req.params.deviceId, req.user);
  return noContent(res);
});

/** GET /devices/:deviceId/alerts */
const listAlerts = asyncHandler(async (req, res) => {
  const alerts = await alertService.listAlerts(req.device._id, req.query);
  return ok(res, alerts);
});

/** GET /devices/:deviceId/alert-rules */
const listRules = asyncHandler(async (req, res) => {
  const rules = await alertService.listRules(req.device._id);
  return ok(res, rules);
});

/** POST /devices/:deviceId/alert-rules */
const createRule = asyncHandler(async (req, res) => {
  const rule = await alertService.createRule(req.device, req.body);
  return created(res, rule);
});

/** PATCH /devices/:deviceId/alert-rules/:ruleId */
const updateRule = asyncHandler(async (req, res) => {
  const rule = await alertService.updateRule(req.device._id, req.params.ruleId, req.body);
  if (!rule) throw ApiError.notFound('RULE_NOT_FOUND', 'Alert rule not found');
  return ok(res, rule);
});

/** DELETE /devices/:deviceId/alert-rules/:ruleId */
const deleteRule = asyncHandler(async (req, res) => {
  const deleted = await alertService.deleteRule(req.device._id, req.params.ruleId);
  if (!deleted) throw ApiError.notFound('RULE_NOT_FOUND', 'Alert rule not found');
  return noContent(res);
});

module.exports = {
  list,
  getOne,
  claim,
  update,
  rotateSecret,
  transfer,
  revoke,
  remove,
  listAlerts,
  listRules,
  createRule,
  updateRule,
  deleteRule,
};
