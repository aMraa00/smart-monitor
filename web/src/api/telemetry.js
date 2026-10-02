import { request } from './client';

/**
 * GET /telemetry/:deviceId
 *
 * Raw shape returned by the API:
 *   { bucket, from, to, series: [{ capability, unit, points: [...] }] }
 * Bucketed points carry { avg, min, max, count }, raw points carry { value }.
 */
export function fetchHistory(deviceId, params = {}) {
  return request({
    method: 'get',
    url: `/telemetry/${encodeURIComponent(deviceId)}`,
    params,
  }).then((r) => r.data);
}

/** GET /telemetry/:deviceId/latest -> { deviceId, ts, timeQuality, capabilities } */
export function fetchLatest(deviceId) {
  return request({
    method: 'get',
    url: `/telemetry/${encodeURIComponent(deviceId)}/latest`,
  }).then((r) => r.data);
}
