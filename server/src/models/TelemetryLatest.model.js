'use strict';

const mongoose = require('mongoose');

/**
 * One document per device holding the most recent sample.
 * Powers dashboard tiles and alert evaluation without scanning the time-series.
 */

const latestReadingSchema = new mongoose.Schema(
  {
    value: { type: Number },
    unit: { type: String, default: '' },
    quality: { type: String, default: 'ok' },
    source: { type: String, default: '' },
    ts: { type: Date },
  },
  { _id: false }
);

const telemetryLatestSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
      unique: true,
      index: true,
    },
    deviceId: { type: String, required: true },
    ts: { type: Date, required: true },
    timeQuality: { type: String, default: 'estimated' },
    capabilities: { type: Map, of: latestReadingSchema, default: () => new Map() },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('TelemetryLatest', telemetryLatestSchema);
