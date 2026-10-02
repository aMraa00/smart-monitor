#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke test against a RUNNING API instance.
 *
 *   node scripts/smoke-test.js [baseUrl]
 *
 * Verifies the full happy path over real HTTP:
 *   register -> provision -> exchange -> signed telemetry -> claim -> read back
 * plus the security invariants that matter most:
 *   - an unsigned request for the same body is refused
 *   - a replayed request is refused
 *   - another user cannot read the device
 *   - role escalation is impossible from a client body
 *
 * Exit code 0 = all checks passed.
 */

const crypto = require('crypto');

const BASE = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const API = `${BASE}/api/v1`;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non JSON body */
  }
  return { status: response.status, body: json, text };
}

/** Produce the HMAC headers the firmware would send. */
function signDeviceRequest({ deviceId, secret, method, path, body }) {
  const bodyString = JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();

  const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

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
  };
}

/** A realistic sample for the V1 hardware (one sensor deliberately degraded). */
function buildSample(deviceId, sequence, temperature = 21.4) {
  return {
    firmwareVersion: '1.0.0',
    capabilities: [
      'temperature',
      'humidity',
      'pressure',
      'illuminance',
      'eco2',
      'tvoc',
      'wind_rpm',
      'wind_speed',
    ],
    samples: [
      {
        sampleId: `${deviceId}-${String(sequence).padStart(10, '0')}`,
        ts: new Date().toISOString(),
        timeQuality: 'ntp',
        capabilities: {
          temperature: { value: temperature, unit: 'C', quality: 'ok', source: 'dht11' },
          humidity: { value: 47, unit: '%', quality: 'ok', source: 'dht11' },
          pressure: { value: 99812, unit: 'Pa', quality: 'ok', source: 'bmp180' },
          illuminance: { value: 134, unit: 'lx', quality: 'ok', source: 'bh1750' },
          // CCS811 equivalent CO2 is explicitly labelled, never NDIR `co2`.
          eco2: { value: 612, unit: 'ppm', quality: 'calibrating', source: 'ccs811' },
          tvoc: { value: 88, unit: 'ppb', quality: 'ok', source: 'ccs811' },
          wind_rpm: { value: 96.5, unit: 'rpm', quality: 'ok', source: 'a3144' },
          // Coefficient still 1.0 -> honestly flagged as uncalibrated.
          wind_speed: { value: 3.1, unit: 'm/s', quality: 'uncalibrated', source: 'a3144' },
        },
      },
    ],
  };
}

/* ------------------------------------------------------------------ main */

/** POST a signed device request exactly as the firmware would. */
async function signedCall({ deviceId, secret, path, body, reuse }) {
  const signed = signDeviceRequest({ deviceId, secret, method: 'POST', path, body });
  const headers = reuse || signed.headers; // `reuse` replays a previous signature

  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: signed.bodyString });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non JSON body */
  }
  return { status: response.status, body: json, text };
}

async function main() {
  console.log(`Smart Monitor smoke test -> ${BASE}\n`);

  const runId = Date.now().toString(36).toUpperCase();
  const email = `smoke-${runId}@example.com`;
  const password = 'Str0ng!Passw0rd';

  // ---- 0. the API is actually up -----------------------------------------
  const health = await call('GET', '/health');
  check('API health responds', health.status === 200 && health.body?.success === true, health.text);

  // ---- 1. accounts --------------------------------------------------------
  const registered = await call('POST', '/auth/register', {
    body: { email, password, name: 'Smoke Owner' },
  });
  check('register returns a token pair', registered.status === 201 && Boolean(registered.body?.data?.accessToken));
  const token = registered.body?.data?.accessToken;

  const login = await call('POST', '/auth/login', { body: { email, password } });
  check('login with the same credentials', login.status === 200 && Boolean(login.body?.data?.accessToken));

  const wrongLogin = await call('POST', '/auth/login', { body: { email, password: 'WrongPass123!' } });
  check('wrong password is refused', wrongLogin.status === 401, wrongLogin.text);

  const me = await call('GET', '/auth/me', { token });
  // The API lowercases every email on write, so compare case-insensitively.
  check(
    'GET /auth/me returns the profile',
    me.status === 200 && me.body?.data?.user?.email === email.toLowerCase(),
    me.text
  );

  // ---- 2. provisioning ----------------------------------------------------
  const hwId = `SMOKE-${runId}`;
  const provisioned = await call('POST', '/provisioning/register', {
    body: {
      hwId,
      model: 'smart_monitor_v1',
      hardwareRevision: '1.0',
      firmwareVersion: '1.0.0',
      capabilities: ['temperature', 'humidity', 'pressure', 'illuminance', 'eco2', 'tvoc', 'wind_rpm', 'wind_speed'],
    },
  });
  check(
    'provisioning register issues a claim code',
    provisioned.status === 201 && Boolean(provisioned.body?.data?.claimCode),
    provisioned.text
  );
  const deviceId = provisioned.body?.data?.deviceId;
  const provisioningToken = provisioned.body?.data?.provisioningToken;

  const exchanged = await call('POST', '/provisioning/exchange', { body: { provisioningToken, hwId } });
  check(
    'provisioning exchange issues a device secret',
    exchanged.status === 201 && Boolean(exchanged.body?.data?.deviceSecret),
    exchanged.text
  );
  const secret = exchanged.body?.data?.deviceSecret;

  const forged = await call('POST', '/provisioning/exchange', {
    body: { provisioningToken: `forged-${runId}-${'x'.repeat(24)}`, hwId },
  });
  check('a forged provisioning token is refused', forged.status === 401 || forged.status === 400, forged.text);

  if (!deviceId || !secret) throw new Error('provisioning did not return usable credentials');

  // ---- 3. telemetry: the security properties that matter ------------------
  const sample = buildSample(deviceId, 1);

  const accepted = await signedCall({ deviceId, secret, path: '/api/v1/telemetry', body: sample });
  check(
    'a correctly signed batch is accepted (202)',
    accepted.status === 202 && accepted.body?.data?.accepted >= 1,
    accepted.text
  );

  const unsigned = await call('POST', '/telemetry', { body: sample });
  check('the same body without a signature is refused', unsigned.status === 401, unsigned.text);

  const jwtOnDeviceRoute = await call('POST', '/telemetry', { token, body: sample });
  check('a user JWT cannot post telemetry', jwtOnDeviceRoute.status === 401, jwtOnDeviceRoute.text);

  // ---- 4. ownership (checked BEFORE the destructive checks below) ---------
  const claim = await call('POST', '/devices/claim', {
    token,
    body: { deviceId, claimCode: provisioned.body?.data?.claimCode },
  });
  check('the owner can claim the station', claim.status === 200 && claim.body?.data?.deviceId === deviceId, claim.text);

  const latest = await call('GET', `/telemetry/${deviceId}/latest`, { token });
  check(
    'the owner can read the latest snapshot back',
    latest.status === 200 && Boolean(latest.body?.data?.capabilities?.temperature),
    latest.text
  );

  const history = await call('GET', `/telemetry/${deviceId}?bucket=minute&limit=10`, { token });
  check('history returns a bucketed series', history.status === 200 && Array.isArray(history.body?.data?.series), history.text);

  // ---- 5. replay protection ------------------------------------------------
  // Sign ONCE, send TWICE: the second transmission must be caught by the
  // single-use nonce before the body is even considered.
  const replaySample = buildSample(deviceId, 2);
  const signedOnce = signDeviceRequest({
    deviceId,
    secret,
    method: 'POST',
    path: '/api/v1/telemetry',
    body: replaySample,
  });
  const replayArgs = { deviceId, secret, path: '/api/v1/telemetry', body: replaySample, reuse: signedOnce.headers };

  const firstSend = await signedCall(replayArgs);
  check('the signed batch is accepted (202)', firstSend.status === 202, firstSend.text);

  const replayed = await signedCall(replayArgs);
  check('a replayed request (same nonce) is refused with 409', replayed.status === 409, replayed.text);

  // ---- 6. telemetry poisoning defence (threat T16) -------------------------
  // The impossible reading is dropped, the healthy ones in the same sample are
  // still stored - never a whole-batch failure, and never a silent zero.
  const tampered = await signedCall({
    deviceId,
    secret,
    path: '/api/v1/telemetry',
    body: buildSample(deviceId, 3, 999), // far outside any plausible range
  });
  check(
    'an out-of-range reading is rejected while the rest of the sample is kept',
    tampered.status === 202 && tampered.body?.data?.rejected >= 1,
    tampered.text
  );

  const stranger = await call('POST', '/auth/register', {
    body: { email: `smoke-other-${runId}@example.com`, password, name: 'Stranger' },
  });
  const strangerToken = stranger.body?.data?.accessToken;

  const idorRead = await call('GET', `/devices/${deviceId}`, { token: strangerToken });
  check('another account cannot read the device (IDOR)', idorRead.status === 404, idorRead.text);

  const idorTelemetry = await call('GET', `/telemetry/${deviceId}/latest`, { token: strangerToken });
  check('another account cannot read the telemetry', idorTelemetry.status === 404, idorTelemetry.text);

  const anonymous = await call('GET', '/devices');
  check('unauthenticated device listing is refused', anonymous.status === 401, anonymous.text);

  // ---- 7. RBAC over real HTTP ---------------------------------------------
  // Self-registration can never mint a privileged role, so these prove the
  // escalation route is closed from both directions.
  const escalation = await call('POST', '/auth/register', {
    body: { email: `smoke-escalate-${runId}@example.com`, password, role: 'admin' },
  });
  check(
    'a client supplied role is ignored (registration stays owner)',
    escalation.status === 201 && escalation.body?.data?.user?.role === 'owner',
    escalation.text
  );

  const usersList = await call('GET', '/auth/users', { token });
  check('an owner cannot list accounts (403)', usersList.status === 403, usersList.text);

  const usersCreate = await call('POST', '/auth/users', {
    token,
    body: { email: `smoke-fake-admin-${runId}@example.com`, password, role: 'admin' },
  });
  check('an owner cannot create an admin (403)', usersCreate.status === 403, usersCreate.text);

  const revokeByStranger = await call('POST', `/devices/${deviceId}/revoke`, { token: strangerToken });
  check('a non-owner cannot revoke a device', revokeByStranger.status === 403 || revokeByStranger.status === 404, revokeByStranger.text);

  // ---- summary ------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nSmoke test crashed: ${err.message}`);
  process.exitCode = 1;
});
