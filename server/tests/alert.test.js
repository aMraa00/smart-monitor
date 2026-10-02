'use strict';

/**
 * FR-F: threshold rules and the anti-flapping state machine.
 */

const h = require('./helpers/harness');
const { Alert } = require('../src/models');

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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function claimedDevice() {
  const owner = await h.registerUser();
  const provisioned = await h.provisionDevice({ capabilities: ['temperature'] });
  const device = await h.claimDevice(
    owner.accessToken,
    provisioned.deviceId,
    provisioned.claimCode
  );
  return { owner, provisioned, device };
}

/** Ingest one temperature value. */
function push(provisioned, sampleId, temperature) {
  return h.signedAgentRequest({
    deviceId: provisioned.deviceId,
    secret: provisioned.deviceSecret,
    path: PATH,
    body: { samples: [h.makeSample(sampleId, { temperature: { value: temperature } })] },
  });
}

/** Create a threshold rule over the API. */
function createRule(owner, device, payload) {
  return h
    .agent()
    .post(`/api/v1/devices/${device.deviceId}/alert-rules`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send(payload);
}

describe('alert rule CRUD', () => {
  it('creates and lists a rule', async () => {
    const { owner, device } = await claimedDevice();

    const created = await createRule(owner, device, {
      capability: 'temperature',
      max: 30,
      severity: 'warning',
      name: 'Too hot',
    }).expect(201);

    expect(created.body.data.capability).toBe('temperature');
    expect(created.body.data.max).toBe(30);

    const list = await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}/alert-rules`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(list.body.data).toHaveLength(1);
  });

  it('requires at least one threshold', async () => {
    const { owner, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature' }).expect(422);
  });

  it('rejects min >= max', async () => {
    const { owner, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', min: 40, max: 10 }).expect(422);
  });

  it('does not let a stranger add a rule to someone else device', async () => {
    const { device } = await claimedDevice();
    const stranger = await h.registerUser();

    await createRule(stranger, device, { capability: 'temperature', max: 30 }).expect(404);
  });
});

describe('alert state machine', () => {
  it('raises immediately when forSeconds is 0', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', max: 30 }).expect(201);

    await push(provisioned, 'S-1', 35);

    const alerts = await Alert.find({}).lean();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].state).toBe('firing');
    expect(alerts[0].breachValue).toBe(35);
  });

  it('resolves the alert when the value returns to range', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', max: 30 }).expect(201);

    await push(provisioned, 'S-1', 35);
    await push(provisioned, 'S-2', 21);

    const alerts = await Alert.find({}).lean();
    expect(alerts).toHaveLength(1); // one alert, now resolved (history kept)
    expect(alerts[0].state).toBe('resolved');
    expect(alerts[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('does not raise for a value inside the range', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', min: 0, max: 30 }).expect(201);

    await push(provisioned, 'S-1', 21);

    expect(await Alert.countDocuments({})).toBe(0);
  });

  it('ignores the rule when the capability is missing from the sample', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', max: 30 }).expect(201);

    // Sensor failed -> capability omitted -> no evaluation, no fabricated zero.
    await h.signedAgentRequest({
      deviceId: provisioned.deviceId,
      secret: provisioned.deviceSecret,
      path: PATH,
      body: { samples: [h.makeSample('S-1', { humidity: { value: 50 } })] },
    });

    expect(await Alert.countDocuments({})).toBe(0);
  });

  it('waits for the anti-flapping window before firing', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', max: 30, forSeconds: 1 }).expect(
      201
    );

    // First breach -> pending, not yet firing.
    await push(provisioned, 'S-1', 35);
    let alerts = await Alert.find({}).lean();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].state).toBe('pending');

    // Breach persists past the window -> firing.
    await wait(1200);
    await push(provisioned, 'S-2', 36);
    alerts = await Alert.find({}).lean();
    expect(alerts[0].state).toBe('firing');
    expect(alerts[0].firedAt).toBeInstanceOf(Date);
  });

  it('never keeps two open alerts for the same capability', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', max: 30 }).expect(201);

    await push(provisioned, 'S-1', 35);
    await push(provisioned, 'S-2', 36);
    await push(provisioned, 'S-3', 37);

    expect(await Alert.countDocuments({ state: { $in: ['pending', 'firing'] } })).toBe(1);
    expect(await Alert.countDocuments({})).toBe(1);
  });
});

describe('alert history API', () => {
  it('returns alerts for the owner', async () => {
    const { owner, provisioned, device } = await claimedDevice();
    await createRule(owner, device, { capability: 'temperature', max: 30 }).expect(201);
    await push(provisioned, 'S-1', 35);

    const response = await h
      .agent()
      .get(`/api/v1/devices/${device.deviceId}/alerts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].state).toBe('firing');
  });
});
