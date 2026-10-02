'use strict';

const { z } = require('zod');
const { deviceId, email, pagination } = require('./common');

const listQuerySchema = z.object({
  status: z.enum(['unclaimed', 'active', 'offline', 'revoked']).optional(),
  ...pagination,
});

const claimSchema = z.object({
  deviceId,
  claimCode: z.string().trim().min(4).max(32),
});

const updateSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  locationName: z.string().trim().max(160).optional(),
  config: z
    .object({
      sampleIntervalS: z.number().int().min(5).max(3600).optional(),
      timezone: z.string().trim().max(64).optional(),
      calibration: z
        .object({
          // 1.0 means "uncalibrated"; any positive value is a measured coefficient.
          windCalibrationCoef: z.number().positive().max(1000).optional(),
          pulsesPerRotation: z.number().int().min(1).max(20).optional(),
        })
        .optional(),
    })
    .optional(),
});

const transferSchema = z.object({ toEmail: email });

module.exports = { listQuerySchema, claimSchema, updateSchema, transferSchema };
