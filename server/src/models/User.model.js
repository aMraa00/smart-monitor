'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');

/**
 * Account roles (RBAC):
 *   admin   - full access: every device, creates/promotes users, manages the fleet
 *   manager - fleet operator: reads every device + tunes settings/alerts, cannot
 *             create or delete users, cannot revoke/delete devices
 *   owner   - device owner: claims and manages their OWN stations only
 *   viewer  - legacy read-only alias, treated like a restricted owner account
 */
const ROLES = ['owner', 'admin', 'manager', 'viewer'];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, trim: true, maxlength: 120, default: '' },
    role: { type: String, enum: ROLES, default: 'owner', required: true },
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
  },
  { timestamps: true, versionKey: false }
);

/** Hash a plaintext password with the configured cost. */
userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
};

/** Compare a plaintext password with the stored hash. */
userSchema.methods.comparePassword = function comparePassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

/** Public representation - never leaks the hash or lock metadata. */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    role: this.role,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
