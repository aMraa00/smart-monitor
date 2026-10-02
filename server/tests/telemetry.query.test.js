'use strict';

/**
 * FR-E: history reads - filters, aggregation buckets and ownership.
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

const PATH = '/api/v1/telemetry';

async function deviceWithHistory() {
  const owner = await h.registerUser();
  const provisioned = await h.provisionDevice({
    capabilities: ['temperature', 'humidity'],
  });
  const device = await h.claimDevice(
    owner.accessToken,
    provisioned.deviceId,
    provisioned.claimCode
  );

  // Three samples spread over ~3 minutes.
  const base = Date.now() - 3 * 60_000;
  const samples = [0, 1, 2].map((index) =>
    h.makeSample(
      `S-${index}`,
      {
        temperature: { value: 20 + index, unit: 'C' },
        humidity: { value: 40 + index, unit: '%' },
      },
      { ts: new Date(base + index * 60_000).toISOString() }
    )
  );

  const response = await h.signedAgentRequest({
    deviceId: provisioned.deviceId,
    secret: provisioned.deviceSecret,
    path: PATH,
    body: { samples },
  });
  expect(response.status).toBe(202);

  return { owner, provisioned, device };
}

/** GET history with a bearer token. */
function getHistory(token, deviceId, query = '') {
  return h
    .agent()
    .get(`/api/v1/telemetry/${deviceId}${query}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('raw history', () => {
  it('returns every stored sample grouped by capability', async () => {
    const { owner, device } = await deviceWithHistory();

    const response = await getHistory(owner.accessToken, device.deviceId).expect(200);

    expect(response.body.data.bucket).toBe('raw');
    const temperature = response.body.data.series.find((s) => s.capability === 'temperature');
    expect(temperature.points).toHaveLength(3);
    expect(temperature.unit).toBe('C');
    expect(temperature.points[0]).toMatchObject({ value: 20, quality: 'ok' });
  });

  it('filters to a single capability', async () => {
    const { owner, device } = await deviceWithHistory();

    const response = await getHistory(
      owner.accessToken,
      device.deviceId,
      '?capability=temperature'
    ).expect(200);

    expect(response.body.data.series).toHaveLength(1);
    expect(response.body.data.series[0].capability).toBe('temperature');
  });

  it('honours an explicit from/to window', async () => {
    const { owner, device } = await deviceWithHistory();

    const from = new Date(Date.now() - 90_000).toISOString();
    const to = new Date().toISOString();

    const response = await getHistory(
      owner.accessToken,
      device.deviceId,
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ).expect(200);

    const temperature = response.body.data.series.find((s) => s.capability === 'temperature');
    expect(temperature.points).toHaveLength(1);
  });

  it('rejects an inverted range', async () => {
    const { owner, device } = await deviceWithHistory();

    const from = new Date().toISOString();
    const to = new Date(Date.now() - 60_000).toISOString();

    const response = await getHistory(
      owner.accessToken,
      device.deviceId,
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ).expect(400);

    expect(response.body.error.code).toBe('TELEMETRY_RANGE');
  });
});

describe('aggregated history', () => {
  it('buckets samples per minute with min/avg/max', async () => {
    const { owner, device } = await deviceWithHistory();

    const response = await getHistory(
      owner.accessToken,
      device.deviceId,
      '?bucket=minute&capability=temperature'
    ).expect(200);

    expect(response.body.data.bucket).toBe('minute');
    const temperature = response.body.data.series[0];
    expect(temperature.points.length).toBeGreaterThan(0);

    const point = temperature.points[0];
    expect(point).toEqual(
      expect.objectContaining({
        min: expect.any(Number),
        max: expect.any(Number),
        avg: expect.any(Number),
        count: expect.any(Number),
      })
    );
    expect(point.avg).toBeGreaterThanOrEqual(point.min);
    expect(point.avg).toBeLessThanOrEqual(point.max);
  });

  it('rejects an unknown bucket name', async () => {
    const { owner, device } = await deviceWithHistory();

    await getHistory(owner.accessToken, device.deviceId, '?bucket=fortnight').expect(422);
  });
});

describe('ownership on reads', () => {
  it('hides history from a stranger', async () => {
    const { device } = await deviceWithHistory();
    const stranger = await h.registerUser();

    await getHistory(stranger.accessToken, device.deviceId).expect(404);
  });

  it('returns an empty series for a device with no data in range', async () => {
    const { owner, device } = await deviceWithHistory();

    const from = new Date(Date.now() + 60_000).toISOString();
    const to = new Date(Date.now() + 120_000).toISOString();

    const response = await getHistory(
      owner.accessToken,
      device.deviceId,
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ).expect(200);

    expect(response.body.data.series).toEqual([]);
  });
});
