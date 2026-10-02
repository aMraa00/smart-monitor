import { useEffect, useState } from 'react';
import DeviceCard from '../features/devices/DeviceCard';
import ClaimDeviceModal from '../features/devices/ClaimDeviceModal';
import EmptyState from '../components/EmptyState';
import { LoadingBlock } from '../components/Spinner';
import { useDeviceStore } from '../stores/deviceStore';
import { useUiStore } from '../stores/uiStore';
import { useDebounce } from '../hooks/useDebounce';

/** Device inventory: search, claim, open. */
export function DevicesPage() {
  const { devices, loading, error, load, claim } = useDeviceStore();
  const toast = useUiStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const debounced = useDebounce(query.trim().toLowerCase(), 200);

  useEffect(() => {
    load().catch(() => {
      /* error surfaced through the store */
    });
  }, [load]);

  const filtered = debounced
    ? devices.filter((device) =>
        [device.displayName, device.deviceId, device.locationName, device.model]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(debounced))
      )
    : devices;

  async function handleClaim(deviceId, claimCode) {
    setClaiming(true);
    try {
      const device = await claim(deviceId, claimCode);
      toast(`Claimed ${device.displayName || device.deviceId}`, 'ok');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Devices</h1>
          <p className="muted">
            {devices.length} station{devices.length === 1 ? '' : 's'} owned
          </p>
        </div>

        <div className="page-header__actions">
          <input
            className="input"
            type="search"
            placeholder="Search name, id, location…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search devices"
          />
          <button type="button" className="button button--primary" onClick={() => setClaimOpen(true)}>
            Claim device
          </button>
        </div>
      </header>

      {error && <p className="form__error">{error}</p>}
      {loading && devices.length === 0 ? (
        <LoadingBlock label="Loading devices" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📡"
          title={devices.length === 0 ? 'No devices claimed yet' : 'Nothing matches that search'}
          hint={
            devices.length === 0
              ? 'Boot a station, open its SoftAP portal, then claim it with the code it shows.'
              : 'Try the device id or a location instead.'
          }
          action={
            devices.length === 0 ? (
              <button type="button" className="button button--primary" onClick={() => setClaimOpen(true)}>
                Claim device
              </button>
            ) : null
          }
        />
      ) : (
        <div className="device-grid">
          {filtered.map((device) => (
            <DeviceCard key={device.deviceId} device={device} />
          ))}
        </div>
      )}

      <ClaimDeviceModal open={claimOpen} onClose={() => setClaimOpen(false)} onClaim={handleClaim} loading={claiming} />
    </>
  );
}

export default DevicesPage;
