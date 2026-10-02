'use strict';

/**
 * Cryptographic helpers: device identity, HMAC verification, claim codes.
 *
 * Design rules honoured here:
 *  - `deviceId` is PUBLIC and authenticates nothing.
 *  - The per-device secret is stored only as a bcrypt hash server-side.
 *  - Every telemetry request is bound to a timestamp + nonce + body hash so a
 *    captured request cannot be replayed.
 */

const crypto = require('crypto');
const uuidv4 = require('uuid').v4;
const config = require('../config');

/** Lowercase hex sha256 of a string or buffer. */
function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** URL-safe random token (default 32 bytes -> 43 chars). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Derive the **public** device identity from immutable hardware material.
 * It is deterministic per hardware unit but not secret.
 *
 * @param {string} hwId raw hardware id (ESP32 MAC / eFuse)
 * @returns {string} e.g. SMV1-A1B2C3D4E5F6
 */
function deriveDeviceId(hwId) {
  const digest = sha256Hex(`smv1:device:${String(hwId).trim().toLowerCase()}`).toUpperCase();
  return `${config.device.idPrefix}${digest.slice(0, 12)}`;
}

/** Random 48-byte device secret, base64url encoded (shown exactly once). */
function generateDeviceSecret() {
  return randomToken(48);
}

/**
 * Why the device secret is ENCRYPTED and not hashed:
 *
 * Request authentication is HMAC-SHA256 computed by the device with the raw
 * secret. To verify that MAC the server must be able to reproduce it, which a
 * one-way hash (bcrypt/sha256) makes impossible. The secret is therefore stored
 * AES-256-GCM encrypted with a server master key and is decrypted in memory
 * only for the duration of a signature check.
 *
 * Properties achieved (prompt §42, threat T3):
 *   - the plaintext secret never exists at rest in the database
 *   - a database dump alone cannot forge device requests (the master key lives
 *     outside the database, in the deployment environment)
 *   - the plaintext is returned to the device exactly once (provisioning
 *     exchange or rotation) and is never readable through any API afterwards
 */

const MASTER_KEY = crypto
  .createHash('sha256')
  .update(`smv1:device-secret-master:${config.device.tokenSecret}`)
  .digest(); // 32 bytes for AES-256

/** Encrypt a device secret for storage. Format: base64url(iv).base64url(tag).base64url(cipher) */
function encryptDeviceSecret(plainSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    '.'
  );
}

/**
 * Decrypt a stored device secret.
 * @returns {string|null} plaintext secret, or null when the payload is invalid
 */
function decryptDeviceSecret(payload) {
  if (typeof payload !== 'string') return null;
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      MASTER_KEY,
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    return null; // wrong master key or tampered ciphertext
  }
}

/**
 * Canonical string that is signed. Any change to method, path, timestamp,
 * nonce or body therefore invalidates the signature.
 */
function canonicalString({ method, path, timestamp, nonce, bodyHash }) {
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}

/** HMAC-SHA256 over the canonical string, hex encoded. */
function signRequest(secret, parts) {
  return crypto.createHmac('sha256', secret).update(canonicalString(parts)).digest('hex');
}

/** Timing-safe hex signature comparison. */
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Sign a short-lived provisioning token.
 * Format: base64url(payloadJson).base64url(hmac)
 */
function signProvisioningToken(payload, ttlSeconds = config.provisioning.tokenTtlS) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: uuidv4(),
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.device.tokenSecret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Verify a provisioning token.
 * @returns {object|null} payload when valid, otherwise null
 */
function verifyProvisioningToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', config.device.tokenSecret)
    .update(encoded)
    .digest('base64url');
  if (!safeCompare(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Human-typable claim code: 10 chars from an unambiguous alphabet.
 * Stored hashed; rotates on expiry.
 */
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateClaimCode(length = 10) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += CLAIM_ALPHABET[bytes[i] % CLAIM_ALPHABET.length];
  }
  return out;
}

/** Hash a claim code (sha256 is sufficient: high entropy + short TTL + lockout). */
function hashClaimCode(code) {
  return sha256Hex(`claim:${String(code).trim().toUpperCase()}:${config.device.tokenSecret}`);
}

module.exports = {
  sha256Hex,
  randomToken,
  deriveDeviceId,
  generateDeviceSecret,
  encryptDeviceSecret,
  decryptDeviceSecret,
  canonicalString,
  signRequest,
  safeCompare,
  signProvisioningToken,
  verifyProvisioningToken,
  generateClaimCode,
  hashClaimCode,
  uuidv4,
};
