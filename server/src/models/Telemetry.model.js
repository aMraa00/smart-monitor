'use strict';

const mongoose = require('mongoose');
const logger = require('../config/logger');

/**
 * Raw telemetry - stored in a MongoDB TIME-SERIES collection.
 *
 *   timeSeries : { timeField: 'ts', metaField: 'device', granularity: 'seconds' }
 *
 * `capabilities` is a MAP (not a fixed column set) so any future sensor can be
 * reported without a migration (prompt §2).
 *
 * NOTE: unique indexes are NOT supported on time-series collections, so
 * idempotent dedup is enforced atomically by the `telemetrykeys` guard
 * collection (see TelemetryKey.model.js).
 */

const readingSchema = new mongoose.Schema(
  {
    value: { type: Number, required: true },
    unit: { type: String, default: '' },
    quality: { type: String, default: 'ok' },
    source: { type: String, default: '' },
  },
  { _id: false }
);

const telemetrySchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true }, // timeField
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true }, // metaField
    deviceId: { type: String, required: true },
    sampleId: { type: String, required: true },
    timeQuality: { type: String, enum: ['ntp', 'synced', 'estimated'], default: 'estimated' },
    firmwareVersion: { type: String, default: '' },
    capabilities: { type: Map, of: readingSchema, default: () => new Map() },
  },
  { collection: 'telemetry', versionKey: false, id: false }
);

// Secondary index for per-device range scans (timeField index is automatic).
telemetrySchema.index({ device: 1, ts: -1 });

const Telemetry = mongoose.model('Telemetry', telemetrySchema);

const COLLECTION_OPTIONS = {
  timeseries: {
    timeField: 'ts',
    metaField: 'device',
    granularity: 'seconds',
  },
  expireAfterSeconds: 400 * 24 * 60 * 60, // raw retention: 400 days
};

/**
 * Create (or repair) the time-series collection.
 *
 * Safe to call repeatedly. It also guards against the classic mistake of the
 * collection already existing as a PLAIN collection (e.g. created by an older
 * deployment or by Mongoose autoCreate): in that case every write lands in the
 * bucket store while reads on the view return nothing. An empty plain
 * collection is dropped and recreated correctly; a non-empty one is a hard
 * error so no data is ever destroyed silently.
 */
async function ensureCollections() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('ensureCollections called before the db connection is ready');

  const existing = await db.listCollections({ name: 'telemetry' }).toArray();

  if (existing.length === 0) {
    try {
      await db.createCollection('telemetry', COLLECTION_OPTIONS);
      logger.info('created time-series collection: telemetry');
    } catch (err) {
      // Concurrent creation on multi-instance startup - harmless.
      if (err.codeName !== 'NamespaceExists') throw err;
    }
  } else if (!existing[0].options || !existing[0].options.timeseries) {
    const count = await db.collection('telemetry').estimatedDocumentCount();
    if (count > 0) {
      throw new Error(
        'Collection "telemetry" exists but is NOT a time-series collection and contains data. ' +
          'Migrate it manually (mongodump -> drop -> createCollection with timeseries -> mongorestore).'
      );
    }
    await db.collection('telemetry').drop().catch(() => {});
    await db.createCollection('telemetry', COLLECTION_OPTIONS);
    logger.warn('recreated "telemetry" as a time-series collection (previous one was empty)');
  }

  await Telemetry.createIndexes();
}

module.exports = Telemetry;
module.exports.ensureCollections = ensureCollections;
module.exports.readingSchema = readingSchema;
