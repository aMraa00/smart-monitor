'use strict';

/**
 * JWT access tokens + rotating refresh tokens (FR-A2, FR-A3, threat T6/T7).
 *
 * - Access token: short-lived, stateless, carries id + role.
 * - Refresh token: opaque random string, stored HASHED, grouped into a family.
 *   Presenting a revoked token revokes the whole family.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { RefreshToken } = require('../models');
const { sha256Hex, randomToken } = require('../utils/crypto.util');
const ApiError = require('../utils/apiError');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a TTL string like "15m" / "30d" / "3600" into milliseconds. */
function ttlToMs(ttl) {
  if (/^\d+$/.test(String(ttl))) return Number(ttl) * 1000;
  const match = /^(\d+)\s*([smhd])$/.exec(String(ttl));
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: MS_PER_DAY }[match[2]];
  return value * unit;
}

/** Sign a short-lived access token for a user. */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, email: user.email, typ: 'access' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl }
  );
}

/**
 * Verify an access token.
 * @returns {{sub:string, role:string, email:string}} decoded payload
 * @throws {ApiError} 401 when invalid/expired or of the wrong type
 */
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    if (payload.typ !== 'access') throw new Error('wrong token type');
    return payload;
  } catch {
    throw ApiError.unauthorized('AUTH_INVALID_TOKEN', 'Access token is invalid or expired');
  }
}

/**
 * Issue a refresh token.
 * @param {object} user mongoose user document
 * @param {{family?:string, userAgent?:string, ip?:string}} [ctx]
 */
async function issueRefreshToken(user, ctx = {}) {
  const plain = randomToken(48);
  const expiresAt = new Date(Date.now() + ttlToMs(config.jwt.refreshTtl));
  await RefreshToken.create({
    user: user._id,
    tokenHash: sha256Hex(plain),
    family: ctx.family || randomToken(16),
    userAgent: ctx.userAgent || '',
    ip: ctx.ip || '',
    expiresAt,
  });
  return plain;
}

/**
 * Rotate a refresh token: consume the old one, issue a new one.
 * Reuse of a revoked token revokes the entire family.
 * @returns {Promise<{user:object, refreshToken:string}>}
 */
async function rotateRefreshToken(plainToken, ctx = {}) {
  const tokenHash = sha256Hex(plainToken);
  const record = await RefreshToken.findOne({ tokenHash }).populate('user');

  if (!record) {
    throw ApiError.unauthorized('AUTH_INVALID_REFRESH', 'Refresh token is not recognised');
  }

  if (record.revoked) {
    // Replay of an already-rotated token -> assume theft, burn the family.
    await RefreshToken.updateMany(
      { family: record.family, revoked: false },
      { $set: { revoked: true, revokedAt: new Date() } }
    );
    throw ApiError.unauthorized(
      'AUTH_REFRESH_REUSE',
      'Refresh token reuse detected; session family revoked'
    );
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('AUTH_REFRESH_EXPIRED', 'Refresh token has expired');
  }

  const nextPlain = randomToken(48);
  record.revoked = true;
  record.revokedAt = new Date();
  record.replacedBy = sha256Hex(nextPlain);
  await record.save();

  await RefreshToken.create({
    user: record.user._id,
    tokenHash: record.replacedBy,
    family: record.family,
    userAgent: ctx.userAgent || record.userAgent,
    ip: ctx.ip || record.ip,
    expiresAt: new Date(Date.now() + ttlToMs(config.jwt.refreshTtl)),
  });

  return { user: record.user, refreshToken: nextPlain };
}

/** Revoke a single refresh token (logout). Unknown tokens are ignored. */
async function revokeRefreshToken(plainToken) {
  await RefreshToken.updateOne(
    { tokenHash: sha256Hex(plainToken) },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
}

/** Revoke every active session for a user (password change / admin action). */
async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { user: userId, revoked: false },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  ttlToMs,
};
