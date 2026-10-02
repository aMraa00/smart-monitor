import { request } from './client';

/** GET /devices */
export async function listDevices(params = {}) {
  const { data, meta } = await request({ method: 'get', url: '/devices', params });
  return { devices: data, meta };
}

/** GET /devices/:deviceId */
export function getDevice(deviceId) {
  return request({ method: 'get', url: `/devices/${encodeURIComponent(deviceId)}` }).then((r) => r.data);
}

/** POST /devices/claim */
export function claimDevice(deviceId, claimCode) {
  return request({ method: 'post', url: '/devices/claim', data: { deviceId, claimCode } }).then((r) => r.data);
}

/** PATCH /devices/:deviceId - presentation and config only, never identity. */
export function updateDevice(deviceId, patch) {
  return request({ method: 'patch', url: `/devices/${encodeURIComponent(deviceId)}`, data: patch }).then((r) => r.data);
}

/** POST /devices/:deviceId/rotate-secret - the new secret is shown exactly once. */
export function rotateSecret(deviceId) {
  return request({ method: 'post', url: `/devices/${encodeURIComponent(deviceId)}/rotate-secret` }).then((r) => r.data);
}

/** POST /devices/:deviceId/transfer */
export function transferDevice(deviceId, toEmail) {
  return request({ method: 'post', url: `/devices/${encodeURIComponent(deviceId)}/transfer`, data: { toEmail } }).then(
    (r) => r.data
  );
}

/** POST /devices/:deviceId/revoke */
export function revokeDevice(deviceId) {
  return request({ method: 'post', url: `/devices/${encodeURIComponent(deviceId)}/revoke` }).then((r) => r.data);
}

/** DELETE /devices/:deviceId */
export function deleteDevice(deviceId) {
  return request({ method: 'delete', url: `/devices/${encodeURIComponent(deviceId)}` });
}

/** GET /devices/:deviceId/alert-rules */
export function listRules(deviceId) {
  return request({ method: 'get', url: `/devices/${encodeURIComponent(deviceId)}/alert-rules` }).then((r) => r.data);
}

/** POST /devices/:deviceId/alert-rules */
export function createRule(deviceId, rule) {
  return request({ method: 'post', url: `/devices/${encodeURIComponent(deviceId)}/alert-rules`, data: rule }).then(
    (r) => r.data
  );
}

/** PATCH /devices/:deviceId/alert-rules/:ruleId */
export function updateRule(deviceId, ruleId, patch) {
  return request({
    method: 'patch',
    url: `/devices/${encodeURIComponent(deviceId)}/alert-rules/${ruleId}`,
    data: patch,
  }).then((r) => r.data);
}

/** DELETE /devices/:deviceId/alert-rules/:ruleId */
export function deleteRule(deviceId, ruleId) {
  return request({ method: 'delete', url: `/devices/${encodeURIComponent(deviceId)}/alert-rules/${ruleId}` });
}

/** GET /devices/:deviceId/alerts */
export function listAlerts(deviceId, params = {}) {
  return request({ method: 'get', url: `/devices/${encodeURIComponent(deviceId)}/alerts`, params }).then((r) => r.data);
}
