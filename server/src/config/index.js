'use strict';

/**
 * Central, validated configuration.
 *
 * Reads from process.env (populated by dotenv in server.js). No credential is
 * ever hard-coded here - only safe development defaults for non-secret values.
 * Secret values without defaults cause a hard failure in production.
 */

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/** Read a required secret; in non-production fall back to a per-process random value. */
function requiredSecret(name) {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value;
  if (isProd) {
    throw new Error(`Missing required secret: ${name} (must be set in production)`);
  }
  // Dev/test only: ephemeral random secret so the app can boot without .env
  return crypto.randomBytes(48).toString('hex');
}

/** Read an integer env var with a default and bounds checking. */
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer (got "${raw}")`);
  }
  return parsed;
}

const config = {
  env: NODE_ENV,
  isProd,
  isTest,
  isDev: !isProd && !isTest,

  port: intEnv('PORT', 5000),
  apiPrefix: '/api/v1',

  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),

  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_monitor_v1',

  jwt: {
    accessSecret: requiredSecret('JWT_ACCESS_SECRET'),
    refreshSecret: requiredSecret('JWT_REFRESH_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  },

  device: {
    tokenSecret: requiredSecret('DEVICE_TOKEN_SECRET'),
    maxClockSkewS: intEnv('DEVICE_MAX_CLOCK_SKEW_S', 300),
    nonceTtlS: intEnv('DEVICE_NONCE_TTL_S', 600),
    telemetryMaxBatch: intEnv('TELEMETRY_MAX_BATCH', 120),
    idPrefix: 'SMV1-',
  },

  provisioning: {
    tokenTtlS: intEnv('PROVISIONING_TOKEN_TTL_S', 900),
    claimCodeTtlS: intEnv('CLAIM_CODE_TTL_S', 900),
  },

  rateLimit: {
    windowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60_000),
    max: intEnv('RATE_LIMIT_MAX', 300),
  },

  redisUrl: process.env.REDIS_URL || '',

  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),

  bcryptRounds: isTest ? 4 : 12,
};

module.exports = config;
