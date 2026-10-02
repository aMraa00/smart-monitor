'use strict';

const mongoose = require('mongoose');

/**
 * Device = hardware identity + ownership + configuration + declared capability.
 *
 * These four concepts are stored in ONE document but are strictly separated by
 * field and by update path (prompt §42):
 *   - identity fields   -> written only by the provisioning service
 *   - owner             -> written only by the claim/transfer service
 *   - config            -> written only by the device-config update path
 *   - capabilities      -> declared by firmware, never inferred from owner
 */

const DEVICE_STATUS = ['unclaimed', 'active', 'offline', 'revoked'];

const deviceSchema = new mongoose.Schema(
  {
    // ---- identity (immutable after provisioning) ----
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^SMV1-[0-9A-F]{12}$/,
    },
    hwId: { type: String, required: true, index: true, select: false },
    model: { type: String, required: true, default: 'smart_monitor_v1', index: true },
    hardwareRevision: { type: String, default: '1.0' },
    firmwareVersion: { type: String, default: '0.0.0' },

    // ---- ownership ----
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // ---- presentation ----
    displayName: { type: String, trim: true, maxlength: 120, default: '' },
    locationName: { type: String, trim: true, maxlength: 160, default: '' },

    // ---- capability model ----
    capabilities: {
      type: [String],
      default: [],
      validate: {
        validator: (list) => list.length <= 40,
        message: 'too many capabilities declared',
      },
    },

    // ---- state ----
    status: { type: String, enum: DEVICE_STATUS, default: 'unclaimed', index: true },
    claimCodeHash: { type: String, default: null, index: true, sparse: true, select: false },
    claimCodeExpiresAt: { type: Date, default: null, select: false },
    claimCodeAttempts: { type: Number, default: 0, select: false },
    lastSeenAt: { type: Date, default: null, index: true },
    provisionedAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },

    // ---- configuration (safe to change any time, never part of identity) ----
    config: {
      sampleIntervalS: { type: Number, default: 60, min: 5, max: 3600 },
      timezone: { type: String, default: 'UTC' },
      calibration: {
        windCalibrationCoef: { type: Number, default: 1 }, // 1.0 == UNCALIBRATED
        pulsesPerRotation: { type: Number, default: 1, min: 1, max: 20 },
      },
    },

    // ---- last reported runtime metadata (informational) ----
    meta: {
      rssi: { type: Number, default: null },
      ip: { type: String, default: null },
      uptimeS: { type: Number, default: null },
      timeQuality: { type: String, default: null },
      backlog: { type: Number, default: null },
      sensors: { type: mongoose.Schema.Types.Mixed, default: {} },
      lastTelemetryAt: { type: Date, default: null },
    },
  },
  { timestamps: true, versionKey: false }
);

/** Compound index for the common owner + status listing query. */
deviceSchema.index({ owner: 1, status: 1, createdAt: -1 });

/** Public representation - claim material and hw identity are never exposed. */
deviceSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    deviceId: this.deviceId,
    model: this.model,
    hardwareRevision: this.hardwareRevision,
    firmwareVersion: this.firmwareVersion,
    displayName: this.displayName,
    locationName: this.locationName,
    capabilities: this.capabilities,
    status: this.status,
    owner: this.owner ? this.owner.toString() : null,
    lastSeenAt: this.lastSeenAt,
    config: this.config,
    meta: this.meta,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

/** Whether the device currently requires a claim code (unclaimed + not revoked). */
deviceSchema.methods.isClaimable = function isClaimable() {
  return this.status === 'unclaimed' || (this.status === 'offline' && !this.owner);
};

module.exports = mongoose.model('Device', deviceSchema);
module.exports.DEVICE_STATUS = DEVICE_STATUS;
