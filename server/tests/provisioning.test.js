'use strict';

/**
 * FR-B + FR-C: device identity, provisioning token exchange, claiming.
 *
 * The central security property under test: `deviceId` is public and by itself
 * must never authorise anything.
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

describe('POST /api/v1/provisioning/register', () => {
  it('creates a device with a non-sequential, hardware-derived id', async () => {
    const response = await h
      .agent()
      .post('/api/v1/provisioning/register')
      .send({
        hwId: 'A0B1C2D3E4F5',
        model: 'smart_monitor_v1',
        hardwareRevision: '1.0',
        firmwareVersion: '1.0.0',
        capabilities: ['temperature', 'humidity', 'pressure'],
      })
      .expect(201);

    const { deviceId, provisioningToken, claimCode } = response.body.data;
    expect(deviceId).toMatch(/^SMV1-[0-9A-F]{12}$/);
    expect(provisioningToken).toEqual(expect.any(String));
    expect(claimCode).toMatch(/^[A-Z2-9]{10}$/);
    // The raw hardware id must never be echoed back.
    expect(response.body.data.hwId).toBeUndefined();
  });

  it('is idempotent per hardware unit (same hwId -> same deviceId)', async () => {
    const hwId = h.uniqueHwId();
    const first = await h
      .agent()
      .post('/api/v1/provisioning/register')
      .send({ hwId, capabilities: ['temperature'] })
      .expect(201);
    const second = await h
      .agent()
      .post('/api/v1/provisioning/register')
      .send({ hwId, capabilities: ['humidity'] })
      .expect(201);

    expect(second.body.data.deviceId).toBe(first.body.data.deviceId);
  });

  it('rejects a missing hwId', async () => {
    const response = await h
      .agent()
      .post('/api/v1/provisioning/register')
      .send({ model: 'smart_monitor_v1' })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/provisioning/exchange', () => {
  it('returns a device secret', async () => {
    const hwId = h.uniqueHwId();
    const registered = await h
      .agent()
      .post('/api/v1/provisioning/register')
      .send({ hwId })
      .expect(201);

    const exchanged = await h
      .agent()
      .post('/api/v1/provisioning/exchange')
      .send({ provisioningToken: registered.body.data.provisioningToken, hwId })
      .expect(201);

    expect(exchanged.body.data.deviceId).toBe(registered.body.data.deviceId);
    expect(exchanged.body.data.deviceSecret).toEqual(expect.any(String));
    expect(exchanged.body.data.deviceSecret.length).toBeGreaterThan(30);
  });

  it('rejects a forged provisioning token', async () => {
    const response = await h
      .agent()
      .post('/api/v1/provisioning/exchange')
      .send({ provisioningToken: 'ZmFrZS10b2tlbi5oYWNrZWQtc2lnbmF0dXJl' })
      .expect(401);
    expect(response.body.error.code).toBe('PROVISION_TOKEN_INVALID');
  });

  it('rejects a token presented with the wrong hardware id', async () => {
    const hwId = h.uniqueHwId();
    const registered = await h
      .agent()
      .post('/api/v1/provisioning/register')
      .send({ hwId })
      .expect(201);

    const response = await h
      .agent()
      .post('/api/v1/provisioning/exchange')
      .send({ provisioningToken: registered.body.data.provisioningToken, hwId: 'OTHER-HARDWARE' })
      .expect(401);
    expect(response.body.error.code).toBe('PROVISION_MISMATCH');
  });
});

describe('POST /api/v1/devices/claim', () => {
  it('lets a logged-in user claim an unowned device', async () => {
    const user = await h.registerUser();
    const provisioned = await h.provisionDevice();

    const device = await h.claimDevice(
      user.accessToken,
      provisioned.deviceId,
      provisioned.claimCode
    );

    expect(device.deviceId).toBe(provisioned.deviceId);
    expect(device.status).toBe('active');
  });

  it('is idempotent for the same owner', async () => {
    const user = await h.registerUser();
    const provisioned = await h.provisionDevice();

    await h.claimDevice(user.accessToken, provisioned.deviceId, provisioned.claimCode);
    await h.claimDevice(user.accessToken, provisioned.deviceId, provisioned.claimCode);
  });

  it('refuses a second owner', async () => {
    const ownerA = await h.registerUser();
    const ownerB = await h.registerUser();
    const provisioned = await h.provisionDevice();
    await h.claimDevice(ownerA.accessToken, provisioned.deviceId, provisioned.claimCode);

    const response = await h
      .agent()
      .post('/api/v1/devices/claim')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ deviceId: provisioned.deviceId, claimCode: provisioned.claimCode })
      .expect(409);

    expect(response.body.error.code).toBe('DEVICE_ALREADY_CLAIMED');
  });

  it('rejects a wrong claim code', async () => {
    const user = await h.registerUser();
    const provisioned = await h.provisionDevice();

    const response = await h
      .agent()
      .post('/api/v1/devices/claim')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ deviceId: provisioned.deviceId, claimCode: 'WRONGCODE1' })
      .expect(400);

    expect(response.body.error.code).toBe('CLAIM_FAILED');
  });

  it('uses the same non-revealing error for an unknown device', async () => {
    const user = await h.registerUser();

    const response = await h
      .agent()
      .post('/api/v1/devices/claim')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ deviceId: 'SMV1-000000000000', claimCode: 'AAAAAAAAAA' })
      .expect(400);

    expect(response.body.error.code).toBe('CLAIM_FAILED');
  });

  it('requires authentication', async () => {
    const provisioned = await h.provisionDevice();
    await h
      .agent()
      .post('/api/v1/devices/claim')
      .send({ deviceId: provisioned.deviceId, claimCode: provisioned.claimCode })
      .expect(401);
  });
});
