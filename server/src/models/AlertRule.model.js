'use strict';

const mongoose = require('mongoose');

/**
 * Threshold rule for one capability of one device.
 *
 * `forSeconds` implements the anti-flapping window: a breach must persist that
 * long before the rule moves from `pending` to `firing`.
 */

const SEVERITIES = ['info', 'warning', 'critical'];

const alertRuleSchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    capability: { type: String, required: true },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    forSeconds: { type: Number, default: 0, min: 0, max: 86_400 },
    severity: { type: String, enum: SEVERITIES, default: 'warning' },
    enabled: { type: Boolean, default: true },
    name: { type: String, trim: true, maxlength: 120, default: '' },
  },
  { timestamps: true, versionKey: false }
);

alertRuleSchema.index({ device: 1, capability: 1, enabled: 1 });

alertRuleSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    device: this.device.toString(),
    capability: this.capability,
    min: this.min,
    max: this.max,
    forSeconds: this.forSeconds,
    severity: this.severity,
    enabled: this.enabled,
    name: this.name,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('AlertRule', alertRuleSchema);
module.exports.SEVERITIES = SEVERITIES;
