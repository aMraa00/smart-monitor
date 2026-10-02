'use strict';

/**
 * Shared test harness: database lifecycle, app instance, and factories for
 * users, devices and correctly HMAC-signed device requests.
 *
 * Keeping the signing logic here (and only here) means the tests prove the
 * canonical string contract that the firmware must implement.
 */

const crypto = require('crypto');
const request = require('supertest');
const mongoose = require('mongoose');

const createApp = require('../../src/app');
const { syncIndexes } = require('../../src/models');

let appInstance = null;
let indexesReady = false;

/** Connect to the shared test database and prepare indexes once. */
async function connectDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
  }
  if (!indexesReady) {
    await syncIndexes();
    indexesReady = true;
  }
  return mongoose.connection;
}

/** Remove all documents without dropping collections (keeps the time-series). */
async function resetDb() {
  const { db } = mongoose.connection;
  const collections = await db.listCollections().toArray();
  await Promise.all(
    collections.map((collection) =>
      db.collection(collection.name).deleteMany({}).catch(() => {})
    )
  );
}

async function closeDb() {
  if (mongoose.connection.readyState !== 0) {
    indexesReady = false;
    await mongoose.connection.close();
  }
}

function getApp() {
  if (!appInstance) appInstance = createApp();
  return appInstance;
}

/** A fresh express agent bound to the app. */
function agent() {
  return request(getApp());
}

/** Unique hardware id per call so tests never collide. */
function uniqueHwId() {
  return `HW-${crypto.randomBytes(8).toString('hex')}`;
}

/** Register a user and return { user, accessToken, refreshToken, email, password }. */
async function registerUser(overrides = {}) {
  const email = overrides.email || `user-${crypto.randomBytes(5).toString('hex')}@example.com`;
  const password = overrides.password || 'Str0ng!Passw0rd';

  const response = await agent()
    .post('/api/v1/auth/register')
    .send({ email, password, name: overrides.name || 'Test Owner' })
    .expect(201);

  return {
    email,
    password,
    user: response.body.data.user,
    accessToken: response.body.data.accessToken,
    refreshToken: response.body.data.refreshToken,
  };
}

/**
 * Full device lifecycle: register -> exchange, optionally claim.
 * @returns {Promise<{deviceId, deviceSecret, claimCode, provisioningToken, hwId}>}
 */
async function provisionDevice(options = {}) {
  const hwId = options.hwId || uniqueHwId();
  const payload = {
    hwId,
    model: options.model || 'smart_monitor_v1',
    hardwareRevision: '1.0',
    firmwareVersion: '1.0.0',
    capabilities: options.capabilities || ['temperature', 'humidity'],
  };

  const registered = await agent().post('/api/v1/provisioning/register').send(payload).expect(201);

  const exchanged = await agent()
    .post('/api/v1/provisioning/exchange')
    .send({ provisioningToken: registered.body.data.provisioningToken, hwId })
    .expect(201);

  return {
    hwId,
    deviceId: exchanged.body.data.deviceId,
    deviceSecret: exchanged.body.data.deviceSecret,
    claimCode: registered.body.data.claimCode,
    provisioningToken: registered.body.data.provisioningToken,
  };
}

/** Claim a provisioned device for a user. */
async function claimDevice(accessToken, deviceId, claimCode) {
  const response = await agent()
    .post('/api/v1/devices/claim')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ deviceId, claimCode })
    .expect(200);
  return response.body.data;
}

/** Build the canonical string that both firmware and server must agree on. */
function canonicalString({ method, path, timestamp, nonce, bodyHash }) {
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}

/** Produce the signed headers for a device request. */
function signHeaders({ deviceId, secret, method = 'POST', path, body }) {
  const bodyString = body === undefined ? '' : JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();

  const signature = crypto
    .createHmac('sha256', secret)
    .update(canonicalString({ method, path, timestamp, nonce, bodyHash }))
    .digest('hex');

  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Body-SHA256': bodyHash,
      'X-Signature': signature,
    },
    bodyString,
    timestamp,
    nonce,
    bodyHash,
  };
}

/** Send a correctly signed device request. */
function signedAgentRequest({ deviceId, secret, path, body, method = 'POST' }) {
  const signed = signHeaders({ deviceId, secret, method, path, body });
  return agent()
    [method.toLowerCase()](path)
    .set(signed.headers)
    .send(body === undefined ? undefined : signed.bodyString);
}

/** Convenience: a valid telemetry sample object. */
function makeSample(sampleId, capabilities, overrides = {}) {
  return {
    sampleId,
    ts: new Date().toISOString(),
    timeQuality: 'ntp',
    capabilities,
    ...overrides,
  };
}

module.exports = {
  connectDb,
  resetDb,
  closeDb,
  getApp,
  agent,
  uniqueHwId,
  registerUser,
  provisionDevice,
  claimDevice,
  canonicalString,
  signHeaders,
  signedAgentRequest,
  makeSample,
};
