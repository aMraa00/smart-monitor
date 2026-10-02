'use strict';

/**
 * FR-G: device management and, most importantly, OWNERSHIP ISOLATION.
 *
 * Every test here asserts that user B cannot see or touch user A's device,
 * independently of what any client-side UI might allow (threat T8).
 */

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

/** Create an owner with one claimed device. */
async function ownerWithDevice() {
  const owner = await h.registerUser();
  const provisioned = await h.provisionDevice({
    capabilities: ['temperature', 'humidity', 'wind_rpm'],
  });
  const device = await h.claimDevice(
    owner.accessToken,
    provisioned.deviceId,
    provisioned.claimCode
  );
  return { owner, provisioned, device };
}

describe('GET /api/v1/devices', () => {
  it('lists only the caller devices', async () => {
    const { owner, device } = await ownerWithDevice();
    const other = await h.registerUser();
    const otherProvisioned = await h.provisionDevice();
    await h.claimDevice(other.accessToken, otherProvisioned.deviceId, otherProvisioned.claimCode);

    const response = await h
      .agent()
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].deviceId).toBe(device.deviceId);
    expect(response.body.meta.total).toBe(1);
  });

  it('never exposes claim material or the hardware id', async () => {
    const { owner, device } = await ownerWithDevice();

    const response = await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.claimCodeHash).toBeUndefined();
    expect(response.body.data.hwId).toBeUndefined();
    expect(response.body.data.claimCode).toBeUndefined();
  });
});

describe('ownership isolation (IDOR)', () => {
  it('hides another owner device behind 404', async () => {
    const { device } = await ownerWithDevice();
    const stranger = await h.registerUser();

    const response = await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);

    // 404 (not 403): the existence of the device is not disclosed (threat T22).
    expect(response.body.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('blocks a stranger from renaming the device', async () => {
    const { device } = await ownerWithDevice();
    const stranger = await h.registerUser();

    await h
      .agent()
      .patch(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({ displayName: 'hijacked' })
      .expect(404);
  });

  it('blocks a stranger from reading telemetry', async () => {
    const { device } = await ownerWithDevice();
    const stranger = await h.registerUser();

    await h
      .agent()
      .get(`/api/v1/telemetry/${device.deviceId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);

    await h
      .agent()
      .get(`/api/v1/telemetry/${device.deviceId}/latest`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
  });

  it('blocks a stranger from rotating the device secret', async () => {
    const { device } = await ownerWithDevice();
    const stranger = await h.registerUser();

    await h
      .agent()
      .post(`/api/v1/devices/${device.deviceId}/rotate-secret`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
  });

  it('requires a token for every device route', async () => {
    const { device } = await ownerWithDevice();

    await h.agent().get('/api/v1/devices').expect(401);
    await h.agent().get(`/api/v1/devices/${device.deviceId}`).expect(401);
    await h.agent().get(`/api/v1/telemetry/${device.deviceId}`).expect(401);
  });
});

describe('PATCH /api/v1/devices/:deviceId', () => {
  it('updates presentation and calibration without touching identity', async () => {
    const { owner, device } = await ownerWithDevice();

    const response = await h
      .agent()
      .patch(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        displayName: 'Greenhouse A',
        locationName: 'South wall',
        config: { sampleIntervalS: 120, calibration: { windCalibrationCoef: 2.5 } },
      })
      .expect(200);

    expect(response.body.data.displayName).toBe('Greenhouse A');
    expect(response.body.data.locationName).toBe('South wall');
    expect(response.body.data.config.sampleIntervalS).toBe(120);
    expect(response.body.data.config.calibration.windCalibrationCoef).toBe(2.5);
    expect(response.body.data.deviceId).toBe(device.deviceId); // identity immutable
  });

  it('rejects an out-of-range sample interval', async () => {
    const { owner, device } = await ownerWithDevice();

    await h
      .agent()
      .patch(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ config: { sampleIntervalS: 1 } })
      .expect(422);
  });
});

describe('POST /api/v1/devices/:deviceId/rotate-secret', () => {
  it('issues a new secret and invalidates the previous one', async () => {
    const { owner, provisioned, device } = await ownerWithDevice();

    const rotated = await h
      .agent()
      .post(`/api/v1/devices/${device.deviceId}/rotate-secret`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(rotated.body.data.deviceSecret).toEqual(expect.any(String));
    expect(rotated.body.data.deviceSecret).not.toBe(provisioned.deviceSecret);

    const body = {
      samples: [h.makeSample(`${device.deviceId}-1`, { temperature: { value: 20 } })],
    };

    const withOldSecret = await h.signedAgentRequest({
      deviceId: device.deviceId,
      secret: provisioned.deviceSecret,
      path: '/api/v1/telemetry',
      body,
    });
    expect(withOldSecret.status).toBe(401);

    const withNewSecret = await h.signedAgentRequest({
      deviceId: device.deviceId,
      secret: rotated.body.data.deviceSecret,
      path: '/api/v1/telemetry',
      body,
    });
    expect(withNewSecret.status).toBe(202);
  });
});

describe('transfer / revoke / delete', () => {
  it('transfers ownership to another account', async () => {
    const { owner, device } = await ownerWithDevice();
    const target = await h.registerUser();

    await h
      .agent()
      .post(`/api/v1/devices/${device.deviceId}/transfer`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ toEmail: target.email })
      .expect(200);

    await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${target.accessToken}`)
      .expect(200);

    await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  it('revokes a device so its HMAC credentials stop working', async () => {
    const { owner, provisioned, device } = await ownerWithDevice();

    await h
      .agent()
      .post(`/api/v1/devices/${device.deviceId}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const response = await h.signedAgentRequest({
      deviceId: device.deviceId,
      secret: provisioned.deviceSecret,
      path: '/api/v1/telemetry',
      body: { samples: [h.makeSample(`${device.deviceId}-1`, { temperature: { value: 20 } })] },
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('DEVICE_REVOKED');
  });

  it('deletes a device and every dependent document', async () => {
    const { owner, provisioned, device } = await ownerWithDevice();

    await h
      .agent()
      .post(`/api/v1/devices/${device.deviceId}/alert-rules`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ capability: 'temperature', max: 30 })
      .expect(201);

    await h.signedAgentRequest({
      deviceId: device.deviceId,
      secret: provisioned.deviceSecret,
      path: '/api/v1/telemetry',
      body: { samples: [h.makeSample(`${device.deviceId}-1`, { temperature: { value: 21 } })] },
    });

    await h
      .agent()
      .delete(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });
});
