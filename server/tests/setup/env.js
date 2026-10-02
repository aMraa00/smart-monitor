'use strict';

/**
 * Runs before any module (including src/config) is required in a test worker.
 * Guarantees deterministic, secret-free test configuration.
 */

process.env.NODE_ENV = 'test';
// Silence logs unless a test explicitly wants them.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

// Deterministic secrets so tokens/signatures are reproducible across workers.
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.DEVICE_TOKEN_SECRET = process.env.DEVICE_TOKEN_SECRET || 'test-device-master-secret';

process.env.DEVICE_MAX_CLOCK_SKEW_S = process.env.DEVICE_MAX_CLOCK_SKEW_S || '300';
process.env.DEVICE_NONCE_TTL_S = process.env.DEVICE_NONCE_TTL_S || '600';
process.env.TELEMETRY_MAX_BATCH = process.env.TELEMETRY_MAX_BATCH || '120';
