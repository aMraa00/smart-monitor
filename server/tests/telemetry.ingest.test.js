'use strict';

/**
 * FR-D5..FR-D7: ingest semantics.
 *
 * Two rules from prompt §42 are asserted directly here:
 *   - a failed sensor is OMITTED, never stored as 0
 *   - at-least-once delivery from the device becomes exactly-once storage
 */

const h = require('./helpers/harness');
const { Telemetry, TelemetryLatest, Device } = require('../src/models');

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

/** Claimed device (so snapshots can also be read back through the API). */
async function claimedDevice() {
  const owner = await h.registerUser();
  const provisioned = await h.provisionDevice({
    capabilities: ['temperature', 'humidity', 'pressure', 'illuminance'],
  });
  const device = await h.claimDevice(
    owner.accessToken,
    provisioned.deviceId,
    provisioned.claimCode
  );
  return { owner, provisioned, device };
}

/** Send a batch for a provisioned device. */
function send(provisioned, samples, extra = {}) {
  return h.signedAgentRequest({
    deviceId: provisioned.deviceId,
    secret: provisioned.deviceSecret,
    path: PATH,
    body: { firmwareVersion: '1.0.0', ...extra, samples },
  });
}

describe('idempotent storage', () => {
  it('stores a sample once even when the device retries the batch', async () => {
    const { provisioned } = await claimedDevice();
    const samples = [h.makeSample('S-1', { temperature: { value: 21.4 } })];

    const first = await send(provisioned, samples);
    expect(first.status).toBe(202);
    expect(first.body.data).toMatchObject({ accepted: 1, duplicates: 0 });

    const retry = await send(provisioned, samples);
    expect(retry.status).toBe(202);
    expect(retry.body.data).toMatchObject({ accepted: 0, duplicates: 1 });

    expect(await Telemetry.countDocuments({})).toBe(1);
  });

  it('accepts only the new samples of a partially duplicated batch', async () => {
    const { provisioned } = await claimedDevice();

    await send(provisioned, [h.makeSample('S-1', { temperature: { value: 20 } })]);
    const mixed = await send(provisioned, [
      h.makeSample('S-1', { temperature: { value: 20 } }),
      h.makeSample('S-2', { temperature: { value: 22 } }),
    ]);

    expect(mixed.body.data).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(await Telemetry.countDocuments({})).toBe(2);
  });
});

describe('failed sensors are omitted, never zero', () => {
  it('does not invent a value for a missing capability', async () => {
    const { provisioned, device } = await claimedDevice();

    // The light sensor failed on this cycle: `illuminance` is simply absent.
    const response = await send(provisioned, [
      h.makeSample('S-1', {
        temperature: { value: 21.4, unit: 'C' },
        humidity: { value: 47, unit: '%' },
      }),
    ]);
    expect(response.status).toBe(202);

    const latest = await TelemetryLatest.findOne({}).lean();
    expect(latest.capabilities.temperature.value).toBe(21.4);
    expect(latest.capabilities.illuminance).toBeUndefined();

    const stored = await Telemetry.findOne({}).lean();
    expect(stored.capabilities.illuminance).toBeUndefined();

    const fresh = await Device.findOne({ deviceId: device.deviceId }).lean();
    expect(fresh.capabilities).toEqual(
      expect.arrayContaining(['temperature', 'humidity', 'pressure', 'illuminance'])
    );
  });

  it('rejects a sample with no usable reading at all', async () => {
    const { provisioned } = await claimedDevice();

    const response = await send(provisioned, [h.makeSample('S-empty', {})]);

    expect(response.status).toBe(202);
    expect(response.body.data).toMatchObject({ accepted: 0, rejected: 1 });
    expect(response.body.data.rejections).toContain('S-empty:empty');
    expect(await Telemetry.countDocuments({})).toBe(0);
  });
});

describe('telemetry poisoning defence', () => {
  it('rejects an unknown capability but keeps the valid readings', async () => {
    const { provisioned } = await claimedDevice();

    const response = await send(provisioned, [
      h.makeSample('S-1', { temperature: { value: 21 }, made_up: { value: 1 } }),
    ]);

    expect(response.body.data.accepted).toBe(1);
    expect(response.body.data.rejections).toContain('S-1:made_up:unknown');
    expect(await Telemetry.countDocuments({})).toBe(1);
  });

  it('rejects a physically impossible value', async () => {
    const { provisioned } = await claimedDevice();

    const response = await send(provisioned, [
      h.makeSample('S-1', { temperature: { value: 9999 } }),
    ]);

    expect(response.body.data).toMatchObject({ accepted: 0, rejected: 1 });
    expect(await Telemetry.countDocuments({})).toBe(0);
  });

  it('keeps valid readings when only one value is out of range', async () => {
    const { provisioned } = await claimedDevice();

    const response = await send(provisioned, [
      h.makeSample('S-1', { temperature: { value: 21 }, humidity: { value: 500 } }),
    ]);

    expect(response.body.data.accepted).toBe(1);
    expect(response.body.data.rejections).toContain('S-1:humidity:out-of-range');

    const stored = await Telemetry.findOne({}).lean();
    expect(stored.capabilities.temperature.value).toBe(21);
    expect(stored.capabilities.humidity).toBeUndefined();
  });
});

describe('batch limits and bookkeeping', () => {
  it('rejects a batch larger than TELEMETRY_MAX_BATCH', async () => {
    const { provisioned } = await claimedDevice();
    const samples = Array.from({ length: 200 }, (_value, index) =>
      h.makeSample(`S-${index}`, { temperature: { value: 20 } })
    );

    const response = await send(provisioned, samples);
    expect(response.status).toBe(422);
  });

  it('updates lastSeenAt, status and the latest snapshot on the device', async () => {
    const { provisioned, device } = await claimedDevice();

    await send(provisioned, [h.makeSample('S-1', { temperature: { value: 25.5 } })]);

    const fresh = await Device.findOne({ deviceId: device.deviceId }).lean();
    expect(fresh.lastSeenAt).toBeInstanceOf(Date);
    expect(fresh.status).toBe('active');
    expect(fresh.meta.timeQuality).toBe('ntp');

    const latest = await TelemetryLatest.findOne({ device: fresh._id }).lean();
    expect(latest.capabilities.temperature.value).toBe(25.5);
  });

  it('stores the newest sample of a batch as the latest snapshot', async () => {
    const { provisioned } = await claimedDevice();
    const older = h.makeSample(
      'S-1',
      { temperature: { value: 10 } },
      { ts: new Date(Date.now() - 60_000).toISOString() }
    );
    const newer = h.makeSample(
      'S-2',
      { temperature: { value: 30 } },
      { ts: new Date().toISOString() }
    );

    await send(provisioned, [older, newer]);

    const latest = await TelemetryLatest.findOne({}).lean();
    expect(latest.capabilities.temperature.value).toBe(30);
  });
});

describe('reading back through the API', () => {
  it('returns the latest snapshot to the owner', async () => {
    const { owner, provisioned, device } = await claimedDevice();

    await send(provisioned, [
      h.makeSample('S-1', {
        temperature: { value: 21.4, unit: 'C' },
        humidity: { value: 47, unit: '%', quality: 'ok' },
      }),
    ]);

    const response = await h
      .agent()
      .get(`/api/v1/telemetry/${device.deviceId}/latest`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.capabilities.temperature.value).toBe(21.4);
    expect(response.body.data.timeQuality).toBe('ntp');
  });

  it('returns 404 before any telemetry has arrived', async () => {
    const { owner, device } = await claimedDevice();

    const response = await h
      .agent()
      .get(`/api/v1/telemetry/${device.deviceId}/latest`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    expect(response.body.error.code).toBe('TELEMETRY_EMPTY');
  });
});
