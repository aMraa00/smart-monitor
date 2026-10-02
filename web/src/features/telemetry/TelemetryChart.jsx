import { useCallback, useEffect, useState } from 'react';
import Card from '../../components/Card';
import LineChart from '../../components/LineChart';
import { LoadingBlock } from '../../components/Spinner';
import { fetchHistory } from '../../api/telemetry';
import { addRealtimeListener } from '../../hooks/useSocket';
import { describeCapability, orderCapabilities } from '../../utils/capabilities';

const RANGES = [
  { key: '6h', label: '6 h', hours: 6, bucket: 'raw' },
  { key: '24h', label: '24 h', hours: 24, bucket: 'minute' },
  { key: '7d', label: '7 d', hours: 24 * 7, bucket: 'hour' },
  { key: '30d', label: '30 d', hours: 24 * 30, bucket: 'day' },
];

/**
 * Historical chart for one device.
 *
 * Long ranges are bucketed SERVER-side (§12) - the browser never downloads
 * days of raw samples, it receives min/avg/max per bucket and renders the
 * band. Short ranges use raw points and refresh when live data arrives.
 */
export function TelemetryChart({ deviceId, capabilities = [] }) {
  const capabilitiesList = orderCapabilities(capabilities);
  const [capability, setCapability] = useState(capabilitiesList[0] || '');
  const [rangeKey, setRangeKey] = useState('6h');
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[0];

  // A device that stops declaring a capability must not leave a dead selector.
  useEffect(() => {
    if (capabilitiesList.length > 0 && !capabilitiesList.includes(capability)) {
      setCapability(capabilitiesList[0]);
    }
  }, [capabilitiesList, capability]);

  const load = useCallback(async () => {
    if (!deviceId || !capability) {
      setHistory(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - range.hours * 60 * 60 * 1000);
      const data = await fetchHistory(deviceId, {
        from: from.toISOString(),
        to: to.toISOString(),
        capability,
        bucket: range.bucket,
        limit: 500,
      });
      setHistory(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [deviceId, capability, range.hours, range.bucket]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh the live window when a sample lands (cheap, debounced by timer).
  useEffect(() => {
    if (range.bucket !== 'raw') return undefined;
    let timer = null;
    const off = addRealtimeListener((event, payload) => {
      if (event !== 'telemetry:new' || payload?.deviceId !== deviceId) return;
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        load();
      }, 3000);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      off();
    };
  }, [deviceId, range.bucket, load]);

  const meta = describeCapability(capability);
  const points = history && history.series[0] ? history.series[0].points : [];

  return (
    <Card
      title="History"
      subtitle={capability ? `${meta.label} · ${range.label} window · ${history?.bucket || range.bucket}` : 'No capability available'}
      actions={
        <div className="control-row">
          <select className="select" value={capability} onChange={(e) => setCapability(e.target.value)} aria-label="Capability">
            {capabilitiesList.map((name) => (
              <option key={name} value={name}>
                {describeCapability(name).label}
              </option>
            ))}
          </select>

          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`segmented__item ${item.key === rangeKey ? 'segmented__item--active' : ''}`.trim()}
                onClick={() => setRangeKey(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {error && <p className="form__error">{error}</p>}
      {!capability ? (
        <p className="muted">This device declares no capabilities yet.</p>
      ) : loading && !history ? (
        <LoadingBlock label="Loading history" />
      ) : (
        <LineChart
          points={points}
          color={meta.color}
          unit={capability === 'pressure' ? 'Pa' : meta.unit}
          decimals={meta.decimals}
          bucket={history?.bucket || range.bucket}
          emptyLabel="No samples in this range yet"
          height={220}
        />
      )}
    </Card>
  );
}

export default TelemetryChart;
