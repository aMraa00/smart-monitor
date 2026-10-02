import { useMemo } from 'react';
import StatTile from '../../components/StatTile';
import { orderCapabilities } from '../../utils/capabilities';

/**
 * Bridges the live telemetry snapshot to a tile.
 *
 * `live` (socket ring buffer) is preferred over the REST snapshot so the tile
 * moves the instant a sample arrives; the REST value still wins on page load
 * and for devices that are offline.
 */
export function CapabilityWidget({ capability, latest, live }) {
  const { reading, trend, time } = useMemo(() => {
    const points = [];
    for (const sample of live) {
      const cap = sample.capabilities && sample.capabilities[capability];
      if (cap) points.push({ ts: sample.ts, value: cap.value });
    }

    const newest = points.length ? points[points.length - 1] : null;
    const fromSnapshot = latest && latest.capabilities ? latest.capabilities[capability] : null;

    return {
      reading: newest ? { ...fromSnapshot, value: newest.value } : fromSnapshot,
      trend: points.map((p) => p.value),
      time: newest ? newest.ts : latest?.ts,
    };
  }, [capability, latest, live]);

  return <StatTile capability={capability} reading={reading} trend={trend} time={time} />;
}

/** Render a tile for every declared capability, in registry order. */
export function CapabilityGrid({ capabilities = [], latest, live }) {
  const ordered = orderCapabilities(capabilities);
  if (ordered.length === 0) return null;

  return (
    <div className="tiles">
      {ordered.map((capability) => (
        <CapabilityWidget key={capability} capability={capability} latest={latest} live={live} />
      ))}
    </div>
  );
}

export default CapabilityWidget;
