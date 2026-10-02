'use strict';

/**
 * Reusable Zod primitives shared by every validator.
 */

const { z } = require('zod');

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24 character hex ObjectId');

const deviceId = z
  .string()
  .regex(/^SMV1-[0-9A-F]{12}$/, 'must look like SMV1-XXXXXXXXXXXX');

const email = z.string().trim().toLowerCase().email('must be a valid email').max(254);

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(128, 'must be at most 128 characters');

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO 8601 date')
  .transform((value) => new Date(value));

const pagination = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
};

const timeQuality = z.enum(['ntp', 'synced', 'estimated']);

module.exports = { objectId, deviceId, email, password, isoDate, pagination, timeQuality };
