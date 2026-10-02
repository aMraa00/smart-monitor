'use strict';

/**
 * Device authentication via per-request HMAC-SHA256 signature.
 *
 * This is the ONLY way a device may submit data. `deviceId` is public and
 * authenticates nothing, so possession of the id is worthless without the
 * secret (prompt §42, threat T1).
 *
 * Signature contract (must match firmware `net/HmacSigner`):
 *
 *   canonical = METHOD \n PATH \n X-Timestamp \n X-Nonce \n X-Body-SHA256
 *   X-Signature = hex( HMAC-SHA256(deviceSecret, canonical) )
 *
 * Replay defence: the nonce is registered exactly once for DEVICE_NONCE_TTL_S
 * and the timestamp must be inside DEVICE_MAX_CLOCK_SKEW_S (threat T2).
 */

const { Device, DeviceCredential } = require('../models');
const ApiError = require('../utils/apiError');
const config = require('../config');
const logger = require('../config/logger');
const {
  sha256Hex,
  signRequest,
  safeCompare,
  decryptDeviceSecret,
} = require('../utils/crypto.util');
const { getNonceStore } = require('../utils/nonceStore');

const HEADERS = {
  deviceId: 'x-device-id',
  timestamp: 'x-timestamp',
  nonce: 'x-nonce',
  bodyHash: 'x-body-sha256',
  signature: 'x-signature',
};

/** Canonical request path as the device sees it (query string excluded). */
function canonicalPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

/**
 * Authenticate a signed device request.
 * On success: `req.device` (mongoose document) and `req.deviceCredential`.
 */
async function authenticateDevice(req, _res, next) {
  try {
    const deviceId = req.get(HEADERS.deviceId);
    const timestamp = req.get(HEADERS.timestamp);
    const nonce = req.get(HEADERS.nonce);
    const bodyHash = req.get(HEADERS.bodyHash);
    const signature = req.get(HEADERS.signature);

    if (!deviceId || !timestamp || !nonce || !bodyHash || !signature) {
      throw ApiError.unauthorized('DEVICE_AUTH_MISSING', 'Signed device headers are required');
    }

    // --- clock skew ---------------------------------------------------------
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt)) {
      throw ApiError.unauthorized('DEVICE_AUTH_TIMESTAMP', 'X-Timestamp must be unix seconds');
    }
    const skewS = Math.abs(Math.floor(Date.now() / 1000) - sentAt);
    if (skewS > config.device.maxClockSkewS) {
      throw ApiError.unauthorized(
        'DEVICE_AUTH_SKEW',
        `Device clock differs by ${skewS}s (max ${config.device.maxClockSkewS}s)`
      );
    }

    // --- body integrity -----------------------------------------------------
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    const computedBodyHash = sha256Hex(raw);
    if (!safeCompare(computedBodyHash, bodyHash)) {
      throw ApiError.unauthorized('DEVICE_AUTH_BODY', 'Request body hash does not match');
    }

    // --- load identity + secret --------------------------------------------
    const device = await Device.findOne({ deviceId });
    if (!device) throw ApiError.unauthorized('DEVICE_AUTH_INVALID', 'Device is not recognised');
    if (device.status === 'revoked') {
      throw ApiError.forbidden('DEVICE_REVOKED', 'This device has been revoked');
    }

    const credential = await DeviceCredential.findOne({ device: device._id }).select('+secretCipher');
    if (!credential || credential.revoked || !credential.secretCipher) {
      throw ApiError.unauthorized('DEVICE_AUTH_INVALID', 'Device is not recognised');
    }

    // --- verify the signature (constant time) ------------------------------
    const secret = decryptDeviceSecret(credential.secretCipher);
    if (!secret) {
      logger.error(
        { deviceId },
        'device secret could not be decrypted - master key mismatch or tampered record'
      );
      throw ApiError.unauthorized('DEVICE_AUTH_INVALID', 'Device is not recognised');
    }

    const expected = signRequest(secret, {
      method: req.method,
      path: canonicalPath(req),
      timestamp,
      nonce,
      bodyHash,
    });

    if (!safeCompare(expected, signature)) {
      throw ApiError.unauthorized('DEVICE_AUTH_SIGNATURE', 'Signature is invalid');
    }

    // --- replay protection --------------------------------------------------
    const nonceKey = `${deviceId}:${nonce}`;
    const isFresh = await getNonceStore().checkAndStore(nonceKey, config.device.nonceTtlS);
    if (!isFresh) {
      throw ApiError.conflict('DEVICE_AUTH_REPLAY', 'Duplicate nonce: request replay detected');
    }

    req.device = device;
    req.deviceCredential = credential;
    req.deviceSignedAt = sentAt;

    // Non-blocking touch of lastUsedAt (never delays the response).
    credential.lastUsedAt = new Date();
    credential.save().catch((err) => logger.debug({ err: err.message }, 'lastUsedAt update failed'));

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticateDevice, canonicalPath, HEADERS };
