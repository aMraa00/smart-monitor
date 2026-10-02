'use strict';

const { z } = require('zod');
const { isoDate, timeQuality } = require('./common');
const config = require('../config');

/**
 * A reading may be sent either as a bare number or as a rich object:
 *   "temperature": 21.4
 *   "temperature": { "value": 21.4, "unit": "C", "quality": "ok", "source": "dht11" }
 */
const readingSchema = z.union([
  z.number(),
  z.object({
    value: z.number(),
    unit: z.string().max(16).optional().default(''),
    quality: z.string().max(24).optional().default('ok'),
    source: z.string().max(32).optional().default(''),
  }),
]);

const sampleSchema = z.object({
  sampleId: z.string().trim().min(1).max(96),
  ts: isoDate,
  timeQuality: timeQuality.optional().default('estimated'),
  // A sample with zero readings is rejected by the service (never store noise).
  capabilities: z.record(readingSchema),
});

const ingestSchema = z.object({
  firmwareVersion: z.string().trim().max(32).optional(),
  hardwareRevision: z.string().trim().max(32).optional(),
  capabilities: z.array(z.string().trim().max(48)).max(40).optional(),
  backlog: z.number().int().min(0).max(1_000_000).optional(),
  samples: z
    .array(sampleSchema)
    .min(1, 'at least one sample is required')
    .max(config.device.telemetryMaxBatch, `at most ${config.device.telemetryMaxBatch} samples per batch`),
});

const querySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  capability: z.string().trim().max(48).optional(),
  bucket: z.enum(['raw', 'minute', 'hour', 'day']).optional().default('raw'),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

module.exports = { ingestSchema, querySchema, readingSchema, sampleSchema };
