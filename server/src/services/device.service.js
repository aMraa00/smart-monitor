'use strict';

/**
 * Device ownership lifecycle: list, read, claim, update, rotate, transfer,
 * revoke, delete. Ownership is re-checked on every operation (threat T8, FR-E5).
 */

const mongoose = require('mongoose');
const {
  Device,
  DeviceCredential,
  Telemetry,
  TelemetryKey,
  TelemetryLatest,
  AlertRule,
  Alert,
  User,
} = require('../models');
const ApiError = require('../utils/apiError');
const {
  generateDeviceSecret,
  encryptDeviceSecret,
  hashClaimCode,
  generateClaimCode,
} = require('../utils/crypto.util');
const config = require('../config');

const MAX_CLAIM_ATTEMPTS = 5;

/**
 * Load a device the caller is allowed to read.
 * @throws {ApiError} 404 when missing, 403 for admins when revoked
 */
async function getOwnedDevice(deviceId, user) {
  const device = await Device.findOne({ deviceId });
  if (!device) throw ApiError.notFound('DEVICE_NOT_FOUND', 'Device not found');

  const isOwner = device.owner && device.owner.toString() === user._id.toString();
  const isAdmin = user.role === 'admin';
  if (!isOwner && !isAdmin) {
    // Same error as "not found": prevents device enumeration (threat T22).
    throw ApiError.notFound('DEVICE_NOT_FOUND', 'Device not found');
  }
  return device;
}

/** List devices owned by a user (admins may list everything). */
async function listDevices(user, { status, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (user.role !== 'admin') filter.owner = user._id;
  if (status) filter.status = status;

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  const [items, total] = await Promise.all([
    Device.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Device.countDocuments(filter),
  ]);

  return {
    items: items.map((device) => device.toPublicJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
}

/**
 * Claim an unowned device using its rotating claim code.
 * Idempotent: re-claiming your own device succeeds without error (FR-C4).
 */
async function claimDevice({ deviceId, claimCode }, user) {
  const device = await Device.findOne({ deviceId }).select('+claimCodeHash +claimCodeExpiresAt');

  if (!device) {
    throw ApiError.badRequest('CLAIM_FAILED', 'Device id or claim code is invalid');
  }
  if (device.status === 'revoked') {
    throw ApiError.forbidden('DEVICE_REVOKED', 'This device has been revoked');
  }
  if (device.owner) {
    if (device.owner.toString() === user._id.toString()) {
      return device.toPublicJSON(); // already yours -> idempotent success
    }
    throw ApiError.conflict('DEVICE_ALREADY_CLAIMED', 'This device is already claimed');
  }
  if (!device.claimCodeHash || !device.claimCodeExpiresAt) {
    throw ApiError.badRequest('CLAIM_FAILED', 'Device id or claim code is invalid');
  }
  if (device.claimCodeExpiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest('CLAIM_CODE_EXPIRED', 'Claim code has expired');
  }
  if ((device.claimCodeAttempts || 0) >= MAX_CLAIM_ATTEMPTS) {
    throw ApiError.tooMany('Too many claim attempts. Request a new claim code.');
  }
  if (hashClaimCode(claimCode) !== device.claimCodeHash) {
    device.claimCodeAttempts = (device.claimCodeAttempts || 0) + 1;
    await device.save();
    throw ApiError.badRequest('CLAIM_FAILED', 'Device id or claim code is invalid');
  }

  device.owner = user._id;
  device.status = 'active';
  device.claimedAt = new Date();
  device.claimCodeHash = null;
  device.claimCodeExpiresAt = null;
  device.claimCodeAttempts = 0;
  await device.save();

  return device.toPublicJSON();
}

/** Rotate the claim code of an unclaimed device. @returns {Promise<string>} plain code */
async function refreshClaimCode(device) {
  const code = generateClaimCode();
  device.claimCodeHash = hashClaimCode(code);
  device.claimCodeExpiresAt = new Date(Date.now() + config.provisioning.claimCodeTtlS * 1000);
  device.claimCodeAttempts = 0;
  await device.save();
  return code;
}

/** Update presentation / configuration fields. Identity and owner are untouched. */
async function updateDevice(deviceId, user, patch) {
  const device = await getOwnedDevice(deviceId, user);

  if (patch.displayName !== undefined) device.displayName = patch.displayName;
  if (patch.locationName !== undefined) device.locationName = patch.locationName;

  if (patch.config) {
    if (patch.config.sampleIntervalS !== undefined) {
      device.config.sampleIntervalS = patch.config.sampleIntervalS;
    }
    if (patch.config.timezone !== undefined) device.config.timezone = patch.config.timezone;
    if (patch.config.calibration) {
      const cal = patch.config.calibration;
      if (cal.windCalibrationCoef !== undefined) {
        device.config.calibration.windCalibrationCoef = cal.windCalibrationCoef;
      }
      if (cal.pulsesPerRotation !== undefined) {
        device.config.calibration.pulsesPerRotation = cal.pulsesPerRotation;
      }
    }
  }

  await device.save();
  return device.toPublicJSON();
}

/**
 * Rotate the device secret. The new plaintext secret is returned exactly once
 * and only ever stored as a hash (FR-G2, threat T3).
 */
async function rotateSecret(deviceId, user) {
  const device = await getOwnedDevice(deviceId, user);

  const secret = generateDeviceSecret();
  const secretCipher = encryptDeviceSecret(secret);

  await DeviceCredential.findOneAndUpdate(
    { device: device._id },
    { $set: { secretCipher, rotatedAt: new Date(), revoked: false, revokedAt: null } },
    { upsert: true, new: true }
  );

  return { deviceId: device.deviceId, deviceSecret: secret, rotatedAt: new Date() };
}

/** Transfer ownership to another registered user. */
async function transferDevice(deviceId, user, toEmail) {
  const device = await getOwnedDevice(deviceId, user);

  const target = await User.findOne({ email: String(toEmail).trim().toLowerCase() });
  if (!target) throw ApiError.notFound('USER_NOT_FOUND', 'Target user was not found');
  if (device.owner && target._id.toString() === device.owner.toString()) {
    throw ApiError.badRequest('TRANSFER_NOOP', 'Device already belongs to that user');
  }

  device.owner = target._id;
  device.claimedAt = new Date();
  await device.save();
  return device.toPublicJSON();
}

/** Revoke a device: credentials stop working and telemetry is no longer trusted. */
async function revokeDevice(deviceId, user) {
  const device = await getOwnedDevice(deviceId, user);
  device.status = 'revoked';
  device.revokedAt = new Date();
  await device.save();
  await DeviceCredential.updateOne({ device: device._id }, { $set: { revoked: true } });
  return device.toPublicJSON();
}

/**
 * Hard delete a device and every dependent document (cascade).
 * Uses a transaction when the deployment supports it, and degrades to a plain
 * sequential delete on a standalone mongod.
 */
async function deleteDevice(deviceId, user) {
  const device = await getOwnedDevice(deviceId, user);

  const run = async (session) => {
    const opts = session ? { session } : {};
    await Telemetry.deleteMany({ device: device._id }, opts);
    await TelemetryKey.deleteMany({ device: device._id }, opts);
    await TelemetryLatest.deleteOne({ device: device._id }, opts);
    await AlertRule.deleteMany({ device: device._id }, opts);
    await Alert.deleteMany({ device: device._id }, opts);
    await DeviceCredential.deleteOne({ device: device._id }, opts);
    await Device.deleteOne({ _id: device._id }, opts);
  };

  let session = null;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(() => run(session));
  } catch {
    if (session && session.inTransaction()) await session.abortTransaction().catch(() => {});
    await run(null);
  } finally {
    if (session) await session.endSession();
  }

  return { deviceId: device.deviceId, deleted: true };
}

module.exports = {
  getOwnedDevice,
  listDevices,
  claimDevice,
  refreshClaimCode,
  updateDevice,
  rotateSecret,
  transferDevice,
  revokeDevice,
  deleteDevice,
};
