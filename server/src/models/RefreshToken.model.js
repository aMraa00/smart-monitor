'use strict';

const mongoose = require('mongoose');

/**
 * Refresh tokens are stored hashed and grouped into a `family`.
 *
 * Rotation: each refresh consumes the old token and issues a new one in the
 * same family. If an already-revoked token is presented again (replay), the
 * ENTIRE family is revoked, forcing a fresh login (threat T7 / FR-A3).
 */

const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    family: { type: String, required: true, index: true },
    revoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false }
);

// TTL index: MongoDB removes expired tokens automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
