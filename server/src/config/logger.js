'use strict';

/**
 * Structured JSON logger (pino) with secret redaction.
 *
 * Secrets must never reach the logs: Authorization headers, HMAC signatures,
 * device secrets, refresh tokens and passwords are redacted centrally here.
 */

const pino = require('pino');
const config = require('./index');

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-signature"]',
  'req.headers["x-device-secret"]',
  'password',
  'passwordHash',
  'deviceSecret',
  'refreshToken',
  'secretHash',
  'token',
];

const logger = pino({
  level: config.logLevel,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'smart-monitor-v1-api', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
