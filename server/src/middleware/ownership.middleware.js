'use strict';

/**
 * Ownership guard (FR-E5, threat T8).
 *
 * Every route that touches a specific device runs through here, so a user can
 * never read or modify another owner's device - regardless of what the frontend
 * chooses to show (prompt §42).
 */

const deviceService = require('../services/device.service');

/** Load `:deviceId` and require the caller to own it (admins bypass). */
async function loadOwnedDevice(req, _res, next) {
  try {
    req.device = await deviceService.getOwnedDevice(req.params.deviceId, req.user);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { loadOwnedDevice };
