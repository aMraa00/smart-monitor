'use strict';

/**
 * First-boot provisioning (FR-B) and claiming material (FR-C).
 *
 * Identity rules enforced here:
 *   - `deviceId` is PUBLIC and authenticates nothing (prompt §42).
 *   - The secret is generated server-side, returned exactly ONCE, and stored
 *     only as a bcrypt hash.
 *   - `hwId` (ESP32 eFuse/MAC) is the only join key between a physical unit and
 *     its cloud identity; it is never returned to any client.
 */

const { Device, DeviceCredential } = require('../models');
const ApiError = require('../utils/apiError');
const config = require('../config');
const {
  deriveDeviceId,
  signProvisioningToken,
  verifyProvisioningToken,
  generateDeviceSecret,
  encryptDeviceSecret,
} = require('../utils/crypto.util');
const { isKnownCapability } = require('../utils/capabilities');
const deviceService = require('./device.service');

/**
 * Register (or re-register) a physical device.
 *
 * Idempotent per hardware unit: the same `hwId` always maps to the same
 * `deviceId`, so a factory reset or reflash does not create duplicates.
 *
 * @returns {Promise<{deviceId, provisioningToken, claimCode, expiresAt, model}>}
 */
async function register({ hwId, model, hardwareRevision, firmwareVersion, capabilities = [] }) {
  if (!hwId || typeof hwId !== 'string') {
    throw ApiError.badRequest('PROVISION_NO_HWID', 'hwId is required');
  }

  const deviceId = deriveDeviceId(hwId);
  const declared = Array.from(new Set(capabilities.filter(isKnownCapability)));

  let device = await Device.findOne({ deviceId });

  if (!device) {
    device = await Device.create({
      deviceId,
      hwId,
      model: model || 'smart_monitor_v1',
      hardwareRevision: hardwareRevision || '1.0',
      firmwareVersion: firmwareVersion || '0.0.0',
      capabilities: declared,
      status: 'unclaimed',
      provisionedAt: new Date(),
    });
  } else {
    if (device.status === 'revoked') {
      throw ApiError.forbidden('DEVICE_REVOKED', 'This device has been revoked');
    }
    // Refresh declared metadata; never touch identity or ownership here.
    if (model) device.model = model;
    if (hardwareRevision) device.hardwareRevision = hardwareRevision;
    if (firmwareVersion) device.firmwareVersion = firmwareVersion;
    if (declared.length) {
      device.capabilities = Array.from(new Set([...device.capabilities, ...declared]));
    }
    device.provisionedAt = device.provisionedAt || new Date();
    await device.save();
  }

  const provisioningToken = signProvisioningToken({ deviceId, hwId });
  const claimCode = await deviceService.refreshClaimCode(device);

  return {
    deviceId,
    model: device.model,
    provisioningToken,
    claimCode,
    expiresAt: new Date(Date.now() + config.provisioning.tokenTtlS * 1000),
    claimCodeExpiresAt: device.claimCodeExpiresAt,
  };
}

/**
 * Exchange a valid provisioning token for the long-lived device secret.
 * The secret is returned exactly once.
 */
async function exchange({ provisioningToken, hwId }) {
  const payload = verifyProvisioningToken(provisioningToken);
  if (!payload) {
    throw ApiError.unauthorized('PROVISION_TOKEN_INVALID', 'Provisioning token is invalid or expired');
  }

  if (hwId && payload.hwId !== hwId) {
    throw ApiError.unauthorized('PROVISION_MISMATCH', 'Provisioning token does not match this hardware');
  }

  const device = await Device.findOne({ deviceId: payload.deviceId });
  if (!device) throw ApiError.notFound('DEVICE_NOT_FOUND', 'Device not found');
  if (device.status === 'revoked') {
    throw ApiError.forbidden('DEVICE_REVOKED', 'This device has been revoked');
  }

  const secret = generateDeviceSecret();
  const secretCipher = encryptDeviceSecret(secret);

  await DeviceCredential.findOneAndUpdate(
    { device: device._id },
    { $set: { secretCipher, rotatedAt: new Date(), revoked: false, revokedAt: null } },
    { upsert: true, new: true }
  );

  return {
    deviceId: device.deviceId,
    deviceSecret: secret,
    model: device.model,
    capabilities: device.capabilities,
    sampleIntervalS: device.config.sampleIntervalS,
    serverTime: new Date(),
  };
}

/**
 * Device heartbeat: liveness + runtime metadata (FR-G3).
 * Called by the device with a signed request, so `device` is already trusted.
 */
async function heartbeat(device, data = {}) {
  device.lastSeenAt = new Date();
  if (device.status === 'offline' && device.owner) device.status = 'active';

  if (data.firmwareVersion) device.firmwareVersion = data.firmwareVersion;
  if (Array.isArray(data.capabilities) && data.capabilities.length) {
    device.capabilities = Array.from(new Set([...device.capabilities, ...data.capabilities.filter(isKnownCapability)]));
  }

  device.meta = {
    ...device.meta,
    rssi: data.rssi ?? device.meta?.rssi ?? null,
    ip: data.ip || device.meta?.ip || null,
    uptimeS: data.uptimeS ?? device.meta?.uptimeS ?? null,
    timeQuality: data.timeQuality || device.meta?.timeQuality || null,
    backlog: data.backlog ?? device.meta?.backlog ?? 0,
    sensors: data.sensors || device.meta?.sensors || {},
  };

  await device.save();
  return { ok: true, serverTime: new Date(), sampleIntervalS: device.config.sampleIntervalS };
}

module.exports = { register, exchange, heartbeat };
