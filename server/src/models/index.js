'use strict';

/**
 * Aggregated model exports + one-time schema/index bootstrap.
 *
 * IMPORTANT: the two mongoose flags below are set HERE (before any model is
 * compiled) because this module is the single entry point every caller uses.
 *
 * Mongoose's `autoCreate` would otherwise create the `telemetry` collection as
 * a PLAIN collection during connection setup, before the time-series bootstrap
 * (Telemetry.ensureCollections) runs. The documents then land in the internal
 * bucket store while the collection view reports zero documents - i.e. all
 * telemetry silently becomes unreadable. Collection and index creation is
 * therefore fully explicit via syncIndexes().
 */

const mongoose = require('mongoose');
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

const User = require('./User.model');
const Device = require('./Device.model');
const DeviceCredential = require('./DeviceCredential.model');
const RefreshToken = require('./RefreshToken.model');
const Telemetry = require('./Telemetry.model');
const TelemetryKey = require('./TelemetryKey.model');
const TelemetryLatest = require('./TelemetryLatest.model');
const AlertRule = require('./AlertRule.model');
const Alert = require('./Alert.model');

/**
 * Ensure every collection exists with the right options and indexes.
 * Called once on boot (and by tests).
 */
async function syncIndexes() {
  await Telemetry.ensureCollections();
  await Promise.all([
    User.syncIndexes(),
    Device.syncIndexes(),
    DeviceCredential.syncIndexes(),
    RefreshToken.syncIndexes(),
    TelemetryKey.syncIndexes(),
    TelemetryLatest.syncIndexes(),
    AlertRule.syncIndexes(),
    Alert.syncIndexes(),
  ]);
}

module.exports = {
  User,
  Device,
  DeviceCredential,
  RefreshToken,
  Telemetry,
  TelemetryKey,
  TelemetryLatest,
  AlertRule,
  Alert,
  syncIndexes,
  /** The closed role vocabulary; the services validate against this list. */
  ROLES: User.ROLES,
};
