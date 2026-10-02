'use strict';

const mongoose = require('mongoose');

/**
 * Dedup guard for telemetry.
 *
 * Time-series collections cannot carry a unique index, so idempotent ingest is
 * enforced here: `{ device, sampleId }` is UNIQUE. Inserting a key that already
 * exists throws a duplicate-key error, which the ingest service treats as
 * "already accepted" (at-least-once delivery from the device, exactly-once
 * storage in the cloud).
 *
 * A TTL keeps the guard bounded; it only needs to outlive the longest offline
 * buffer drain window of any device.
 */

const telemetryKeySchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
    sampleId: { type: String, required: true },
    ts: { type: Date, required: true, default: Date.now },
  },
  { collection: 'telemetrykeys', versionKey: false }
);

telemetryKeySchema.index({ device: 1, sampleId: 1 }, { unique: true });
telemetryKeySchema.index({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 days

module.exports = mongoose.model('TelemetryKey', telemetryKeySchema);
