import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { LoadingBlock } from '../components/Spinner';
import { CapabilityGrid } from '../features/telemetry/CapabilityWidget';
import TelemetryChart from '../features/telemetry/TelemetryChart';
import AlertsPanel from '../features/telemetry/AlertsPanel';
import DeviceSettingsPanel from '../features/devices/DeviceSettingsPanel';
import TransferForm from '../features/devices/TransferForm';
import * as devicesApi from '../api/devices';
import { useDeviceStore } from '../stores/deviceStore';
import { useUiStore } from '../stores/uiStore';
import { useTelemetry } from '../hooks/useTelemetry';
import { subscribeDevice } from '../hooks/useSocket';
import { isOnline, formatDateTime, formatRelative, STATUS_TONE } from '../utils/formatters';

/**
 * Everything about one station: live readings, history, alert rules,
 * configuration and the ownership/danger actions.
 *
 * Ownership is enforced server-side on every call; this page never assumes the
 * user still owns the device (a transfer or revoke elsewhere simply results in
 * a 404 that we render as "not found").
 */
export function DeviceDetailPage() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);
  const merge = useDeviceStore((s) => s.merge);
  const remove = useDeviceStore((s) => s.remove);

  const [device, setDevice] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'revoke' | 'delete'

  const { latest, live, loading: telemetryLoading } = useTelemetry(deviceId);

  const loadDevice = useCallback(async () => {
    setError(null);
    try {
      const found = await devicesApi.getDevice(deviceId);
      setDevice(found);
      merge(deviceId, found);
      return found;
    } catch (err) {
      setError(err);
      return null;
    }
  }, [deviceId, merge]);

  useEffect(() => {
    setDevice(null);
    loadDevice();
  }, [loadDevice]);

  // Join the device room so live samples and alerts arrive while this page is open.
  useEffect(() => subscribeDevice(deviceId, () => {}), [deviceId]);

  async function save(patch) {
    setSaving(true);
    try {
      const updated = await devicesApi.updateDevice(deviceId, patch);
      setDevice(updated);
      merge(deviceId, updated);
      toast('Device updated', 'ok');
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    try {
      const result = await devicesApi.rotateSecret(deviceId);
      setSecret(result.deviceSecret);
      toast('New secret issued - copy it now', 'warn');
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function transfer(toEmail) {
    try {
      await devicesApi.transferDevice(deviceId, toEmail);
      await loadDevice();
      toast(`Transferred to ${toEmail}`, 'ok');
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function revoke() {
    try {
      await devicesApi.revokeDevice(deviceId);
      await loadDevice();
      toast('Device revoked - its HMAC credentials no longer work', 'warn');
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setConfirm(null);
    }
  }

  async function destroy() {
    try {
      await devicesApi.deleteDevice(deviceId);
      remove(deviceId);
      toast('Device deleted', 'ok');
      navigate('/devices', { replace: true });
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setConfirm(null);
    }
  }

  if (error) {
    return (
      <EmptyState
        icon="🚫"
        title={error.status === 404 ? 'Device not found' : 'Could not load this device'}
        hint={
          error.status === 404
            ? 'It may have been transferred away, deleted, or never existed.'
            : error.message
        }
        action={
          <Link className="button button--primary" to="/devices">
            Back to devices
          </Link>
        }
      />
    );
  }

  if (!device) return <LoadingBlock label="Loading device" />;

  const online = isOnline(device.lastSeenAt);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="breadcrumb">
            <Link to="/devices">Devices</Link> / {device.displayName || device.deviceId}
          </p>
          <h1>{device.displayName || device.deviceId}</h1>
          <p className="muted">
            <code>{device.deviceId}</code> · {device.model} · fw {device.firmwareVersion} ·{' '}
            {device.locationName || 'no location'}
          </p>
        </div>

        <div className="page-header__actions">
          <Badge tone={online ? 'ok' : 'warn'}>{online ? 'online' : 'offline'}</Badge>
          <Badge tone={STATUS_TONE[device.status] || 'neutral'}>{device.status}</Badge>
          <span className="muted">last seen {formatRelative(device.lastSeenAt)}</span>
        </div>
      </header>

      <Card title="Live readings" subtitle="Streamed over the realtime channel as samples arrive">
        {telemetryLoading && live.length === 0 ? (
          <LoadingBlock label="Loading readings" />
        ) : latest ? (
          <>
            <CapabilityGrid capabilities={device.capabilities} latest={latest} live={live} />
            <p className="muted">
              sample {formatDateTime(latest.ts)} · time quality <strong>{latest.timeQuality || 'unknown'}</strong>
            </p>
          </>
        ) : (
          <EmptyState icon="⏳" title="No telemetry yet" hint="Waiting for the first sample from this station." />
        )}
      </Card>

      <TelemetryChart deviceId={device.deviceId} capabilities={device.capabilities} />

      <AlertsPanel deviceId={device.deviceId} capabilities={device.capabilities} />

      <DeviceSettingsPanel device={device} onSave={save} saving={saving} />

      <div className="two-col">
        <Card
          title="Credentials"
          subtitle="The device secret authenticates telemetry uploads (HMAC). Rotating it takes effect immediately."
          actions={
            <button type="button" className="button button--ghost" onClick={rotate}>
              Rotate secret
            </button>
          }
        >
          <p className="muted">
            The previous secret stops working the moment a new one is issued, and the new value is shown
            exactly once.
          </p>
          <TransferForm onTransfer={transfer} />
        </Card>

        <Card title="Danger zone" subtitle="Revoking or deleting breaks the station's access to this platform">
          <div className="button-row">
            <button type="button" className="button button--ghost" onClick={() => setConfirm('revoke')}>
              Revoke device
            </button>
            <button type="button" className="button button--danger" onClick={() => setConfirm('delete')}>
              Delete device
            </button>
          </div>
          <p className="muted">
            Revoked: telemetry is rejected but history is kept. Deleted: the device and every dependent
            document (telemetry, rules, alerts) is removed.
          </p>
        </Card>
      </div>

      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="New device secret">
        <p className="form__hint">Copy this now - it is never shown again.</p>
        <pre className="code-block">{secret}</pre>
        <button type="button" className="button button--primary" onClick={() => setSecret(null)}>
          I stored it safely
        </button>
      </Modal>

      <Modal
        open={confirm === 'revoke'}
        onClose={() => setConfirm(null)}
        title="Revoke this device?"
        footer={
          <>
            <button type="button" className="button button--ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="button button--danger" onClick={revoke}>
              Revoke
            </button>
          </>
        }
      >
        <p>
          The station will no longer be able to upload telemetry. Historical data stays available and the
          device can be transferred to a new owner later.
        </p>
      </Modal>

      <Modal
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete this device?"
        footer={
          <>
            <button type="button" className="button button--ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="button button--danger" onClick={destroy}>
              Delete permanently
            </button>
          </>
        }
      >
        <p>
          This removes the device, its telemetry, alert rules and alert history. It cannot be undone.
        </p>
      </Modal>
    </>
  );
}

export default DeviceDetailPage;
