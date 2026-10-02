'use strict';

/**
 * Telemetry ingest + query (FR-D, FR-E).
 *
 * Ingest guarantees:
 *   - a sensor that failed is OMITTED from the sample, never stored as 0 (prompt §42)
 *   - unknown capabilities and physically implausible values are REJECTED, so a
 *     compromised device cannot poison the dataset (threat T16)
 *   - storage is exactly-once even though the device delivers at-least-once:
 *     the `telemetrykeys` guard collection enforces unique {device, sampleId}
 *   - a 202 ACK means "durably accepted": only then may the device erase its
 *     MicroSD record (FR-D8)
 */

const { Telemetry, TelemetryKey, TelemetryLatest } = require('../models');
const logger = require('../config/logger');
const config = require('../config');
const emitter = require('../socket/emitter');
const alertService = require('./alert.service');
const { isKnownCapability, isValueInRange } = require('../utils/capabilities');

/**
 * Aggregation bucket -> MongoDB `$dateTrunc` unit.
 * `raw` means "no aggregation": documents are returned as stored.
 */
const BUCKETS = { raw: null, minute: 'minute', hour: 'hour', day: 'day' };

/**
 * Normalise the raw `capabilities` map of one incoming sample.
 * @returns {{readings: Map<string,object>, rejected: string[]}}
 */
function normaliseCapabilities(raw) {
  const readings = new Map();
  const rejected = [];

  if (!raw || typeof raw !== 'object') return { readings, rejected };

  for (const [name, reading] of Object.entries(raw)) {
    if (!isKnownCapability(name)) {
      rejected.push(`${name}:unknown`);
      continue;
    }
    const value = typeof reading === 'object' && reading !== null ? reading.value : reading;
    if (!isValueInRange(name, value)) {
      rejected.push(`${name}:out-of-range`);
      continue;
    }
    readings.set(name, {
      value: Number(value),
      unit: reading.unit || '',
      quality: reading.quality || 'ok',
      source: reading.source || '',
    });
  }

  return { readings, rejected };
}

/**
 * Prepare incoming samples: validate, drop unusable ones, never invent values.
 * @returns {{prepared:Array, rejections:string[]}}
 */
function prepareSamples(samples) {
  const prepared = [];
  const rejections = [];

  for (const sample of samples) {
    const { readings, rejected } = normaliseCapabilities(sample.capabilities);

    if (rejected.length) rejections.push(...rejected.map((r) => `${sample.sampleId}:${r}`));

    // A sample with no usable reading is rejected entirely: never store noise.
    // When individual readings were already reported as rejected, that detail
    // is kept and we do NOT also report a redundant `:empty` marker.
    if (readings.size === 0) {
      if (rejected.length === 0) rejections.push(`${sample.sampleId}:empty`);
      continue;
    }

    prepared.push({
      sampleId: String(sample.sampleId),
      ts: new Date(sample.ts),
      timeQuality: sample.timeQuality || 'estimated',
      readings,
    });
  }

  return { prepared, rejections };
}

/**
 * Atomically reserve the sampleIds of this batch.
 * Existing keys mean "already stored" -> counted as duplicates, not errors.
 *
 * @returns {Promise<{duplicateIndexes:Set<number>, failedIndexes:Set<number>}>}
 */
async function reserveSampleIds(device, prepared) {
  const duplicateIndexes = new Set();
  const failedIndexes = new Set();

  try {
    await TelemetryKey.insertMany(
      prepared.map((sample) => ({ device: device._id, sampleId: sample.sampleId, ts: sample.ts })),
      { ordered: false }
    );
  } catch (err) {
    const writeErrors = err.writeErrors || [];
    if (writeErrors.length === 0) throw err;

    for (const writeError of writeErrors) {
      const code = writeError.code || (writeError.err && writeError.err.code);
      if (code === 11000) duplicateIndexes.add(writeError.index);
      else failedIndexes.add(writeError.index);
    }

    // Release guard keys of samples we could not store, so a retry can succeed.
    if (failedIndexes.size > 0) {
      await TelemetryKey.deleteMany({
        device: device._id,
        sampleId: { $in: [...failedIndexes].map((index) => prepared[index].sampleId) },
      }).catch(() => {});
    }
  }

  return { duplicateIndexes, failedIndexes };
}

/**
 * Ingest a signed batch from a device.
 *
 * @param {object} device mongoose Device document (already HMAC-verified)
 * @param {object} payload validated request body
 * @returns {Promise<{accepted:number, duplicates:number, rejected:number, rejections:string[]}>}
 */
async function ingest(device, payload) {
  const samples = payload.samples.slice(0, config.device.telemetryMaxBatch);
  const { prepared, rejections } = prepareSamples(samples);

  if (prepared.length === 0) {
    return { accepted: 0, duplicates: 0, rejected: rejections.length, rejections };
  }

  // ---- 1. atomic dedup guard ------------------------------------------------
  const { duplicateIndexes, failedIndexes } = await reserveSampleIds(device, prepared);
  if (failedIndexes.size > 0) {
    rejections.push(...[...failedIndexes].map((index) => `${prepared[index].sampleId}:guard-failed`));
  }

  const acceptedSamples = prepared.filter(
    (_sample, index) => !duplicateIndexes.has(index) && !failedIndexes.has(index)
  );

  if (acceptedSamples.length === 0) {
    return {
      accepted: 0,
      duplicates: duplicateIndexes.size,
      rejected: rejections.length,
      rejections,
    };
  }

  // ---- 2. durable write (time-series collection) ----------------------------
  await Telemetry.insertMany(
    acceptedSamples.map((sample) => ({
      ts: sample.ts,
      device: device._id,
      deviceId: device.deviceId,
      sampleId: sample.sampleId,
      timeQuality: sample.timeQuality,
      firmwareVersion: payload.firmwareVersion || device.firmwareVersion || '',
      capabilities: Object.fromEntries(sample.readings),
    })),
    { ordered: false }
  );

  // ---- 3. latest snapshot (newest sample of the batch wins) -----------------
  const newest = acceptedSamples.reduce((a, b) => (a.ts >= b.ts ? a : b));
  const latestCapabilities = Object.fromEntries(
    [...newest.readings.entries()].map(([name, reading]) => [name, { ...reading, ts: newest.ts }])
  );

  await TelemetryLatest.findOneAndUpdate(
    { device: device._id },
    {
      $set: {
        deviceId: device.deviceId,
        ts: newest.ts,
        timeQuality: newest.timeQuality,
        capabilities: latestCapabilities,
      },
    },
    { upsert: true, new: true }
  );

  // ---- 4. device bookkeeping ------------------------------------------------
  device.lastSeenAt = new Date();
  if (device.status === 'offline' && device.owner) device.status = 'active';
  if (payload.firmwareVersion) device.firmwareVersion = payload.firmwareVersion;
  device.meta = {
    ...device.meta,
    lastTelemetryAt: new Date(),
    timeQuality: newest.timeQuality,
    backlog: payload.backlog ?? device.meta?.backlog ?? 0,
  };
  await device.save();

  // ---- 5. realtime + alerts (must never block the ACK) ----------------------
  emitter.emitToDeviceAndOwner(device.deviceId, device.owner, 'telemetry:new', {
    deviceId: device.deviceId,
    ts: newest.ts,
    timeQuality: newest.timeQuality,
    capabilities: latestCapabilities,
  });

  try {
    await alertService.evaluate(device, newest.readings, newest.ts);
  } catch (err) {
    logger.error({ err: err.message, deviceId: device.deviceId }, 'alert evaluation failed');
  }

  logger.info(
    {
      deviceId: device.deviceId,
      accepted: acceptedSamples.length,
      duplicates: duplicateIndexes.size,
      rejected: rejections.length,
    },
    'telemetry ingested'
  );

  return {
    accepted: acceptedSamples.length,
    duplicates: duplicateIndexes.size,
    rejected: rejections.length,
    rejections,
  };
}

/** Latest snapshot for a device (dashboard tiles). */
async function latest(deviceObjectId) {
  const doc = await TelemetryLatest.findOne({ device: deviceObjectId }).lean();
  if (!doc) return null;

  const capabilities = {};
  for (const [name, reading] of Object.entries(doc.capabilities || {})) {
    capabilities[name] = {
      value: reading.value,
      unit: reading.unit || '',
      quality: reading.quality || 'ok',
      source: reading.source || '',
      ts: reading.ts,
    };
  }

  return {
    deviceId: doc.deviceId,
    ts: doc.ts,
    timeQuality: doc.timeQuality,
    capabilities,
  };
}

/**
 * Read history for a device.
 *
 * @param {import('mongoose').Types.ObjectId} deviceObjectId
 * @param {{from:Date,to:Date,capability?:string,bucket?:string,limit?:number}} params
 * @returns {Promise<{bucket:string, from:Date, to:Date, series:Array}>}
 */
async function query(deviceObjectId, { from, to, capability, bucket = 'raw', limit = 1000 }) {
  const unit = BUCKETS[bucket];
  const match = { device: deviceObjectId, ts: { $gte: from, $lte: to } };
  const maxPoints = Math.min(Math.max(Number(limit) || 1000, 1), 5000);

  // ---- raw: return the readings as stored -----------------------------------
  if (!unit) {
    const docs = await Telemetry.find(match).sort({ ts: 1 }).limit(maxPoints).lean();
    const seriesMap = new Map();

    for (const doc of docs) {
      for (const [name, reading] of Object.entries(doc.capabilities || {})) {
        if (capability && name !== capability) continue;
        if (!seriesMap.has(name)) seriesMap.set(name, { capability: name, unit: reading.unit || '', points: [] });
        seriesMap.get(name).points.push({
          ts: doc.ts,
          value: reading.value,
          quality: reading.quality || 'ok',
          source: reading.source || '',
        });
      }
    }

    return { bucket: 'raw', from, to, series: [...seriesMap.values()] };
  }

  // ---- bucketed: server-side aggregation for long ranges --------------------
  const pipeline = [
    { $match: match },
    { $project: { ts: 1, caps: { $objectToArray: '$capabilities' } } },
    { $unwind: '$caps' },
    ...(capability ? [{ $match: { 'caps.k': capability } }] : []),
    {
      $group: {
        _id: {
          bucket: { $dateTrunc: { date: '$ts', unit, timezone: 'UTC' } },
          name: '$caps.k',
        },
        unit: { $first: '$caps.v.unit' },
        avg: { $avg: '$caps.v.value' },
        min: { $min: '$caps.v.value' },
        max: { $max: '$caps.v.value' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.bucket': 1 } },
    { $limit: maxPoints },
  ];

  const rows = await Telemetry.aggregate(pipeline);
  const seriesMap = new Map();

  for (const row of rows) {
    const name = row._id.name;
    if (!seriesMap.has(name)) {
      seriesMap.set(name, { capability: name, unit: row.unit || '', points: [] });
    }
    seriesMap.get(name).points.push({
      ts: row._id.bucket,
      avg: Math.round(row.avg * 1000) / 1000,
      min: row.min,
      max: row.max,
      count: row.count,
    });
  }

  return { bucket, from, to, series: [...seriesMap.values()] };
}

module.exports = { ingest, latest, query, prepareSamples, normaliseCapabilities };
