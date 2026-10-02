'use strict';

const { z } = require('zod');

const registerSchema = z.object({
  hwId: z.string().trim().min(4, 'hwId is required').max(64),
  model: z.string().trim().max(64).optional().default('smart_monitor_v1'),
  hardwareRevision: z.string().trim().max(32).optional().default('1.0'),
  firmwareVersion: z.string().trim().max(32).optional().default('0.0.0'),
  capabilities: z.array(z.string().trim().min(1).max(48)).max(40).optional().default([]),
});

const exchangeSchema = z.object({
  provisioningToken: z.string().min(20, 'provisioningToken is required'),
  hwId: z.string().trim().min(4).max(64).optional(),
});

const heartbeatSchema = z.object({
  firmwareVersion: z.string().trim().max(32).optional(),
  rssi: z.number().int().min(-150).max(20).optional(),
  ip: z.string().trim().max(64).optional(),
  uptimeS: z.number().int().min(0).optional(),
  timeQuality: z.enum(['ntp', 'synced', 'estimated']).optional(),
  backlog: z.number().int().min(0).optional(),
  capabilities: z.array(z.string().trim().max(48)).max(40).optional(),
  sensors: z.record(z.string().max(48)).optional(),
});

module.exports = { registerSchema, exchangeSchema, heartbeatSchema };
