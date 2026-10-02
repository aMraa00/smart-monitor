import { useCallback, useEffect, useState } from 'react';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import EmptyState from '../../components/EmptyState';
import { LoadingBlock } from '../../components/Spinner';
import * as devicesApi from '../../api/devices';
import { addRealtimeListener } from '../../hooks/useSocket';
import { describeCapability, orderCapabilities } from '../../utils/capabilities';
import { formatDateTime, formatValue } from '../../utils/formatters';

const SEVERITIES = ['info', 'warning', 'critical'];
const STATE_TONE = { firing: 'danger', pending: 'warn', resolved: 'ok' };

/**
 * Threshold rules + alert history for one device.
 *
 * The rule engine itself lives server-side (state machine, anti-flapping
 * window, exactly one open alert per capability). This panel only edits rules
 * and listens for `alert:raised` / `alert:resolved`, so two open tabs cannot
 * disagree about the current state.
 */
export function AlertsPanel({ deviceId, capabilities = [] }) {
  const capabilitiesList = orderCapabilities(capabilities);
  const [rules, setRules] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    capability: capabilitiesList[0] || '',
    min: '',
    max: '',
    forSeconds: 60,
    severity: 'warning',
    name: '',
  });

  const reload = useCallback(async () => {
    try {
      const [ruleList, alertList] = await Promise.all([
        devicesApi.listRules(deviceId),
        devicesApi.listAlerts(deviceId, { limit: 20 }),
      ]);
      setRules(ruleList);
      setAlerts(alertList);
      setError(null);
    } catch (err) {
      setError(err.message);
      setRules([]);
    }
  }, [deviceId]);

  useEffect(() => {
    setRules(null);
    reload();
  }, [reload]);

  // Live alert transitions update the panel without a manual refresh.
  useEffect(() => {
    const off = addRealtimeListener((event, payload) => {
      if (!payload || payload.deviceId !== deviceId) return;
      if (event === 'alert:raised' || event === 'alert:resolved') reload();
    });
    return off;
  }, [deviceId, reload]);

  async function createRule(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await devicesApi.createRule(deviceId, {
        capability: form.capability,
        min: form.min === '' ? null : Number(form.min),
        max: form.max === '' ? null : Number(form.max),
        forSeconds: Number(form.forSeconds),
        severity: form.severity,
        name: form.name.trim(),
      });
      setModalOpen(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule) {
    await devicesApi.updateRule(deviceId, rule.id, { enabled: !rule.enabled });
    await reload();
  }

  async function removeRule(rule) {
    await devicesApi.deleteRule(deviceId, rule.id);
    await reload();
  }

  if (rules === null) return <LoadingBlock label="Loading alerts" />;

  return (
    <Card
      title="Alerts"
      subtitle="Threshold rules with an anti-flapping window"
      actions={
        <button type="button" className="button button--primary" onClick={() => setModalOpen(true)}>
          New rule
        </button>
      }
    >
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {rules.length === 0 ? (
        <EmptyState icon="🚨" title="No alert rules yet" hint="Get notified when a reading leaves its safe range." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Range</th>
              <th>For</th>
              <th>Severity</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const meta = describeCapability(rule.capability);
              const lo = rule.min === null ? '-inf' : formatValue(rule.min, { decimals: meta.decimals });
              const hi = rule.max === null ? '+inf' : formatValue(rule.max, { decimals: meta.decimals });
              return (
                <tr key={rule.id}>
                  <td>{meta.label}</td>
                  <td>
                    {lo} - {hi} {meta.unit}
                  </td>
                  <td>{rule.forSeconds}s</td>
                  <td>
                    <Badge tone={rule.severity === 'critical' ? 'danger' : rule.severity === 'warning' ? 'warn' : 'info'}>
                      {rule.severity}
                    </Badge>
                  </td>
                  <td>
                    <button type="button" className="button button--ghost" onClick={() => toggleRule(rule)}>
                      {rule.enabled ? 'on' : 'off'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="button button--ghost" onClick={() => removeRule(rule)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="subsection__title">Recent activity</h3>
      {alerts.length === 0 ? (
        <p className="muted">Nothing has breached a rule on this device.</p>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => (
            <li key={alert.id} className="alert-list__item">
              <Badge tone={STATE_TONE[alert.state] || 'neutral'}>{alert.state}</Badge>
              <span className="alert-list__capability">{describeCapability(alert.capability).label}</span>
              <span className="alert-list__value">{formatValue(alert.lastValue, { decimals: 1 })}</span>
              <span className="alert-list__time">{formatDateTime(alert.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New alert rule">
        <form className="form" onSubmit={createRule}>
          <label className="field">
            <span>Capability</span>
            <select value={form.capability} onChange={(e) => setForm({ ...form, capability: e.target.value })} required>
              {capabilitiesList.map((name) => (
                <option key={name} value={name}>
                  {describeCapability(name).label}
                </option>
              ))}
            </select>
          </label>

          <div className="form__grid">
            <label className="field">
              <span>Min</span>
              <input
                type="number"
                step="any"
                value={form.min}
                onChange={(e) => setForm({ ...form, min: e.target.value })}
                placeholder="empty = none"
              />
            </label>
            <label className="field">
              <span>Max</span>
              <input
                type="number"
                step="any"
                value={form.max}
                onChange={(e) => setForm({ ...form, max: e.target.value })}
                placeholder="empty = none"
              />
            </label>
            <label className="field">
              <span>Must persist (s)</span>
              <input
                type="number"
                min="0"
                max="86400"
                value={form.forSeconds}
                onChange={(e) => setForm({ ...form, forSeconds: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Severity</span>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Name (optional)</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
          </label>

          <button type="submit" className="button button--primary button--block" disabled={saving}>
            {saving ? 'Saving…' : 'Create rule'}
          </button>
        </form>
      </Modal>
    </Card>
  );
}

export default AlertsPanel;
