'use strict';

const mongoose = require('mongoose');

/**
 * Alert state machine per (device, capability):
 *
 *   (none) --breach--> pending --persist forSeconds--> firing --clear--> resolved
 *
 * Only ONE open alert may exist per (device, capability) at a time; resolved
 * alerts are kept for history.
 */

const ALERT_STATES = ['pending', 'firing', 'resolved'];

const alertSchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    deviceId: { type: String, required: true },
    capability: { type: String, required: true },
    state: { type: String, enum: ALERT_STATES, default: 'pending', index: true },
    severity: { type: String, default: 'warning' },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: 'AlertRule', default: null },
    breachValue: { type: Number, default: null },
    lastValue: { type: Number, default: null },
    message: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    firedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    notifications: {
      type: [{ channel: String, at: Date, ok: Boolean, detail: String }],
      default: [],
      select: false,
    },
  },
  { timestamps: true, versionKey: false }
);

// Fast lookup of the single open alert for a device + capability.
alertSchema.index(
  { device: 1, capability: 1, state: 1 },
  { partialFilterExpression: { state: { $in: ['pending', 'firing'] } } }
);
alertSchema.index({ device: 1, startedAt: -1 });

alertSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    deviceId: this.deviceId,
    capability: this.capability,
    state: this.state,
    severity: this.severity,
    breachValue: this.breachValue,
    lastValue: this.lastValue,
    message: this.message,
    startedAt: this.startedAt,
    firedAt: this.firedAt,
    resolvedAt: this.resolvedAt,
  };
};

module.exports = mongoose.model('Alert', alertSchema);
module.exports.ALERT_STATES = ALERT_STATES;
