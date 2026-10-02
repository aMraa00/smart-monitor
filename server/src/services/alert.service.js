'use strict';

/**
 * Alert engine (FR-F, P6).
 *
 * State machine per (device, capability):
 *
 *     (none) --breach--> pending --(persist forSeconds)--> firing
 *        ^                                                   |
 *        +---------- value back in range -------------------+
 *                    (pending|firing -> resolved)
 *
 * Anti-flapping: a single out-of-range sample does NOT raise an alert when
 * `forSeconds > 0`; the breach must persist for the whole window.
 * Exactly one open alert exists per (device, capability) at any time.
 */

const { AlertRule, Alert } = require('../models');
const logger = require('../config/logger');
const emitter = require('../socket/emitter');

async function listRules(deviceObjectId) {
  const rules = await AlertRule.find({ device: deviceObjectId }).sort({ createdAt: -1 });
  return rules.map((rule) => rule.toPublicJSON());
}

async function createRule(device, payload) {
  const rule = await AlertRule.create({
    device: device._id,
    capability: payload.capability,
    min: payload.min ?? null,
    max: payload.max ?? null,
    forSeconds: payload.forSeconds ?? 0,
    severity: payload.severity || 'warning',
    name: payload.name || '',
  });
  return rule.toPublicJSON();
}

async function updateRule(deviceObjectId, ruleId, payload) {
  const rule = await AlertRule.findOne({ _id: ruleId, device: deviceObjectId });
  if (!rule) return null;
  ['capability', 'min', 'max', 'forSeconds', 'severity', 'enabled', 'name'].forEach((field) => {
    if (payload[field] !== undefined) rule[field] = payload[field];
  });
  await rule.save();
  return rule.toPublicJSON();
}

async function deleteRule(deviceObjectId, ruleId) {
  const result = await AlertRule.deleteOne({ _id: ruleId, device: deviceObjectId });
  return result.deletedCount > 0;
}

async function listAlerts(deviceObjectId, { state, limit = 50 } = {}) {
  const filter = { device: deviceObjectId };
  if (state) filter.state = state;
  const alerts = await Alert.find(filter)
    .sort({ startedAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200));
  return alerts.map((alert) => alert.toPublicJSON());
}

/** @returns {boolean} whether the value breaches the rule thresholds */
function breaches(rule, value) {
  if (rule.min !== null && rule.min !== undefined && value < rule.min) return true;
  if (rule.max !== null && rule.max !== undefined && value > rule.max) return true;
  return false;
}

/** Human readable reason for the breach. */
function breachMessage(rule, value) {
  if (rule.min !== null && rule.min !== undefined && value < rule.min) {
    return `${rule.capability} ${value} below minimum ${rule.min}`;
  }
  return `${rule.capability} ${value} above maximum ${rule.max}`;
}

/** Push an alert transition to the device room and the owner room. */
function notifyAlert(event, device, alert) {
  emitter.emitToDeviceAndOwner(device.deviceId, device.owner, event, {
    alertId: alert._id.toString(),
    deviceId: device.deviceId,
    capability: alert.capability,
    value: alert.lastValue,
    severity: alert.severity,
    state: alert.state,
    startedAt: alert.startedAt,
    resolvedAt: alert.resolvedAt,
  });
  logger.info({ event, deviceId: device.deviceId, capability: alert.capability }, 'alert transition');
}

/**
 * Evaluate all enabled rules of a device against one sample.
 *
 * @param {object} device mongoose Device document
 * @param {Map<string,object>} capabilities normalised capability map
 * @param {Date} ts sample timestamp
 * @returns {Promise<{raised:Array, resolved:Array}>}
 */
async function evaluate(device, capabilities, ts) {
  const raised = [];
  const resolved = [];

  const rules = await AlertRule.find({ device: device._id, enabled: true }).lean();
  if (rules.length === 0) return { raised, resolved };

  const openAlerts = await Alert.find({
    device: device._id,
    state: { $in: ['pending', 'firing'] },
  });
  const openByCapability = new Map(openAlerts.map((alert) => [alert.capability, alert]));

  for (const rule of rules) {
    const reading = capabilities.get(rule.capability);
    if (!reading || typeof reading.value !== 'number') continue; // sensor missing -> skip

    const value = reading.value;
    const isBreach = breaches(rule, value);
    const open = openByCapability.get(rule.capability);

    if (isBreach && !open) {
      const alert = await Alert.create({
        device: device._id,
        deviceId: device.deviceId,
        capability: rule.capability,
        state: rule.forSeconds > 0 ? 'pending' : 'firing',
        severity: rule.severity,
        rule: rule._id,
        breachValue: value,
        lastValue: value,
        message: breachMessage(rule, value),
        startedAt: ts,
        firedAt: rule.forSeconds > 0 ? null : ts,
      });
      openByCapability.set(rule.capability, alert);
      if (alert.state === 'firing') {
        raised.push(alert.toPublicJSON());
        notifyAlert('alert:raised', device, alert);
      }
      continue;
    }

    if (isBreach && open) {
      open.lastValue = value;
      const elapsedS = (Date.now() - new Date(open.startedAt).getTime()) / 1000;
      if (open.state === 'pending' && elapsedS >= rule.forSeconds) {
        open.state = 'firing';
        open.firedAt = ts;
        await open.save();
        raised.push(open.toPublicJSON());
        notifyAlert('alert:raised', device, open);
      } else {
        await open.save();
      }
      continue;
    }

    if (!isBreach && open) {
      open.state = 'resolved';
      open.resolvedAt = ts;
      open.lastValue = value;
      await open.save();
      openByCapability.delete(rule.capability);
      resolved.push(open.toPublicJSON());
      notifyAlert('alert:resolved', device, open);
    }
  }

  return { raised, resolved };
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  listAlerts,
  evaluate,
};
