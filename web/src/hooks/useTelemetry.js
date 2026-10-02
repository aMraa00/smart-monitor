import { useCallback, useEffect, useState } from 'react';
import { fetchLatest } from '../api/telemetry';
import { addRealtimeListener } from './useSocket';

/** Live samples kept in memory; bounded so a long session never grows unbounded. */
const MAX_LIVE_SAMPLES = 240;

/**
 * Live view of one device's telemetry (§10.3).
 *
 * Bootstraps from `GET /telemetry/:id/latest` (a brand-new device answers 404,
 * which is a normal state, not an error), then merges every `telemetry:new`
 * into a bounded ring buffer that powers the live tiles.
 *
 * A device may be offline for days; `live` simply stays empty and the tiles
 * show the last stored snapshot with its age.
 */
export function useTelemetry(deviceId) {
  const [latest, setLatest] = useState(null);
  const [live, setLive] = useState([]);
  const [loading, setLoading] = useState(Boolean(deviceId));
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!deviceId) return null;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchLatest(deviceId);
      setLatest(snapshot);
      setLive([{ ts: snapshot.ts, capabilities: snapshot.capabilities }]);
      return snapshot;
    } catch (err) {
      // 404 TELEMETRY_EMPTY = the device has never reported; not a failure.
      if (err.status !== 404) setError(err.message);
      setLatest(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) {
      setLatest(null);
      setLive([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    (async () => {
      try {
        const snapshot = await fetchLatest(deviceId);
        if (cancelled) return;
        setLatest(snapshot);
        setLive([{ ts: snapshot.ts, capabilities: snapshot.capabilities }]);
      } catch (err) {
        if (!cancelled && err.status !== 404) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    unsubscribe = addRealtimeListener((event, payload) => {
      if (event !== 'telemetry:new' || !payload || payload.deviceId !== deviceId) return;
      const snapshot = {
        deviceId: payload.deviceId,
        ts: payload.ts,
        timeQuality: payload.timeQuality,
        capabilities: payload.capabilities,
      };
      setLatest(snapshot);
      setLive((prev) => [...prev, { ts: payload.ts, capabilities: payload.capabilities }].slice(-MAX_LIVE_SAMPLES));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [deviceId]);

  return { latest, live, loading, error, reload };
}
