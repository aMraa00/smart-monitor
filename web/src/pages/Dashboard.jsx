import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import { LoadingBlock } from '../components/Spinner';
import { CapabilityGrid } from '../features/telemetry/CapabilityWidget';
import { useDeviceStore } from '../stores/deviceStore';
import { useTelemetry } from '../hooks/useTelemetry';
import { isOnline, formatRelative } from '../utils/formatters';

/**
 * Landing page: fleet health at a glance plus the live readings of the
 * currently selected station.
 *
 * The tile grid is generated from `device.capabilities`, so a station with a
 * different sensor set renders itself without any change here (§10.2).
 */
export function DashboardPage() {
  const { devices, loading, load } = useDeviceStore();
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (devices.length === 0) {
      load().catch(() => {
        /* surfaced by the store */
      });
    }
  }, [devices.length, load]);

  // Fall back to the first device whenever the selection disappears.
  useEffect(() => {
    if (!selectedId && devices.length > 0) setSelectedId(devices[0].deviceId);
    if (selectedId && devices.length > 0 && !devices.some((d) => d.deviceId === selectedId)) {
      setSelectedId(devices[0].deviceId);
    }
  }, [devices, selectedId]);

  const selected = useMemo(() => devices.find((d) => d.deviceId === selectedId) || null, [devices, selectedId]);
  const { latest, live, loading: telemetryLoading } = useTelemetry(selected?.deviceId);

  const onlineCount = devices.filter((d) => isOnline(d.lastSeenAt)).length;
  const capabilityCount = devices.reduce((total, d) => total + (d.capabilities?.length || 0), 0);

  if (loading && devices.length === 0) return <LoadingBlock label="Loading dashboard" />;

  if (devices.length === 0) {
    return (
      <EmptyState
        icon="🏁"
        title="Welcome to Smart Monitor"
        hint="You have no stations yet. Claim your first device to start seeing live environmental data."
        action={
          <Link className="button button--primary" to="/devices">
            Go to devices
          </Link>
        }
      />
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Fleet overview and live readings</p>
        </div>

        <label className="field field--inline">
          <span className="sr-only">Device</span>
          <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.displayName || device.deviceId}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="stat-row">
        <Card className="stat-card">
          <span className="stat-card__label">Stations</span>
          <strong className="stat-card__value">{devices.length}</strong>
        </Card>
        <Card className="stat-card">
          <span className="stat-card__label">Reporting now</span>
          <strong className="stat-card__value">{onlineCount}</strong>
        </Card>
        <Card className="stat-card">
          <span className="stat-card__label">Capabilities</span>
          <strong className="stat-card__value">{capabilityCount}</strong>
        </Card>
        <Card className="stat-card">
          <span className="stat-card__label">Selected</span>
          <strong className="stat-card__value stat-card__value--small">
            {selected ? (selected.displayName || selected.deviceId) : '—'}
          </strong>
        </Card>
      </div>

      {selected && (
        <Card
          title={selected.displayName || selected.deviceId}
          subtitle={`${selected.locationName || 'No location'} · last seen ${formatRelative(selected.lastSeenAt)}`}
          actions={<Badge tone={isOnline(selected.lastSeenAt) ? 'ok' : 'warn'}>{isOnline(selected.lastSeenAt) ? 'online' : 'offline'}</Badge>}
        >
          {telemetryLoading && live.length === 0 ? (
            <LoadingBlock label="Loading readings" />
          ) : latest ? (
            <>
              <CapabilityGrid capabilities={selected.capabilities} latest={latest} live={live} />
              <p className="muted">
                time quality: <strong>{latest.timeQuality || 'unknown'}</strong> · sample{' '}
                {formatRelative(latest.ts)}
              </p>
            </>
          ) : (
            <EmptyState
              icon="⏳"
              title="No telemetry yet"
              hint="The station is registered but has not delivered a sample. Check its Wi-Fi or wait for the next upload."
            />
          )}
          <p>
            <Link to={`/devices/${selected.deviceId}`}>Open device →</Link>
          </p>
        </Card>
      )}
    </>
  );
}

export default DashboardPage;
