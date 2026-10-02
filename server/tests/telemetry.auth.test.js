'use strict';

/**
 * FR-D2..FR-D4, threats T1/T2: the HMAC request contract.
 *
 * These tests are the executable specification the firmware must satisfy.
 */

const crypto = require('crypto');
const h = require('./helpers/harness');

beforeAll(async () => {
  await h.connectDb();
});

afterEach(async () => {
  await h.resetDb();
});

afterAll(async () => {
  await h.closeDb();
});

const PATH = '/api/v1/telemetry';

/** Provision a device and return it together with a valid telemetry body. */
async function deviceWithBody(sampleId = 'S-1') {
  const provisioned = await h.provisionDevice();
  const body = {
    firmwareVersion: '1.0.0',
    capabilities: ['temperature', 'humidity'],
    samples: [
      h.makeSample(sampleId, {
        temperature: { value: 21.4, unit: 'C', quality: 'ok', source: 'dht11' },
        humidity: { value: 47, unit: '%', quality: 'ok', source: 'dht11' },
      }),
    ],
  };
  return { provisioned, body };
}

describe('accepted requests', () => {
  it('accepts a correctly signed batch with 202', async () => {
    const { provisioned, body } = await deviceWithBody();

    const response = await h.signedAgentRequest({
      deviceId: provisioned.deviceId,
      secret: provisioned.deviceSecret,
      path: PATH,
      body,
    });

    expect(response.status).toBe(202);
    expect(response.body.data).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });
  });
});

describe('rejected requests', () => {
  it('rejects a request without signed headers', async () => {
    const { body } = await deviceWithBody();

    const response = await h.agent().post(PATH).send(body);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_MISSING');
  });

  it('rejects a bad signature', async () => {
    const { provisioned, body } = await deviceWithBody();
    const signed = h.signHeaders({
      deviceId: provisioned.deviceId,
      secret: provisioned.deviceSecret,
      path: PATH,
      body,
    });

    const response = await h
      .agent()
      .post(PATH)
      .set({ ...signed.headers, 'X-Signature': 'f'.repeat(64) })
      .send(signed.bodyString);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_SIGNATURE');
  });

  it('rejects a signature made with a different device secret', async () => {
    const { provisioned, body } = await deviceWithBody();
    const other = await h.provisionDevice();

    const signed = h.signHeaders({
      deviceId: provisioned.deviceId,
      secret: other.deviceSecret, // wrong key
      path: PATH,
      body,
    });

    const response = await h.agent().post(PATH).set(signed.headers).send(signed.bodyString);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_SIGNATURE');
  });

  it('rejects a body that does not match the signed hash', async () => {
    const { provisioned, body } = await deviceWithBody();
    const signed = h.signHeaders({
      deviceId: provisioned.deviceId,
      secret: provisioned.deviceSecret,
      path: PATH,
      body,
    });

    const tampered = JSON.parse(signed.bodyString);
    tampered.samples[0].capabilities.temperature.value = 999;

    const response = await h
      .agent()
      .post(PATH)
      .set(signed.headers)
      .send(JSON.stringify(tampered));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_BODY');
  });

  it('rejects a replayed request (same nonce)', async () => {
    const { provisioned, body } = await deviceWithBody();
    const signed = h.signHeaders({
      deviceId: provisioned.deviceId,
      secret: provisioned.deviceSecret,
      path: PATH,
      body,
    });

    const first = await h.agent().post(PATH).set(signed.headers).send(signed.bodyString);
    expect(first.status).toBe(202);

    const replay = await h.agent().post(PATH).set(signed.headers).send(signed.bodyString);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('DEVICE_AUTH_REPLAY');
  });

  it('rejects a timestamp outside the allowed skew window', async () => {
    const { provisioned, body } = await deviceWithBody();
    const bodyString = JSON.stringify(body);
    const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600); // one hour old
    const nonce = crypto.randomUUID();

    const signature = crypto
      .createHmac('sha256', provisioned.deviceSecret)
      .update(h.canonicalString({ method: 'POST', path: PATH, timestamp, nonce, bodyHash }))
      .digest('hex');

    const response = await h
      .agent()
      .post(PATH)
      .set({
        'Content-Type': 'application/json',
        'X-Device-Id': provisioned.deviceId,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Body-SHA256': bodyHash,
        'X-Signature': signature,
      })
      .send(bodyString);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_SKEW');
  });

  it('rejects an unknown device id', async () => {
    const { body } = await deviceWithBody();
    const signed = h.signHeaders({
      deviceId: 'SMV1-000000000000',
      secret: 'whatever',
      path: PATH,
      body,
    });

    const response = await h.agent().post(PATH).set(signed.headers).send(signed.bodyString);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_INVALID');
  });

  it('rejects a device id that is not in the SMV1 format', async () => {
    const { provisioned, body } = await deviceWithBody();
    const signed = h.signHeaders({
      deviceId: 'DEVICE001', // sequential ids are not valid identity
      secret: provisioned.deviceSecret,
      path: PATH,
      body,
    });

    const response = await h.agent().post(PATH).set(signed.headers).send(signed.bodyString);
    expect(response.status).toBe(401);
  });
});

describe('trust separation', () => {
  it('refuses a user JWT on the device write endpoint', async () => {
    const user = await h.registerUser();
    const { body } = await deviceWithBody();

    const response = await h
      .agent()
      .post(PATH)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(body);

    // A user token is NOT device authentication.
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('DEVICE_AUTH_MISSING');
  });

  it('contains no way for a device id alone to authorize a write', async () => {
    const { provisioned, body } = await deviceWithBody();

    const response = await h
      .agent()
      .post(PATH)
      .set({ 'Content-Type': 'application/json', 'X-Device-Id': provisioned.deviceId })
      .send(body);

    expect(response.status).toBe(401);
  });
});
