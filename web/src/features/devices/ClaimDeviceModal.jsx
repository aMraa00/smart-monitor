import { useState } from 'react';
import Modal from '../../components/Modal';

/**
 * Claim an unowned device with the code shown on the device display.
 *
 * The server owns every rule here (expiry, attempt counter, already-claimed);
 * this dialog only collects the two values and surfaces the API error verbatim.
 */
export function ClaimDeviceModal({ open, onClose, onClaim, loading }) {
  const [deviceId, setDeviceId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await onClaim(deviceId.trim().toUpperCase(), claimCode.trim().toUpperCase());
      setDeviceId('');
      setClaimCode('');
      onClose();
    } catch (err) {
      setError(err.message || 'Claim failed');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Claim a device">
      <form className="form" onSubmit={submit}>
        <p className="form__hint">
          Find the claim code on the device screen (or serial output) after it boots. It expires in a few minutes.
        </p>

        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span>Device ID</span>
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="SMV1-A1B2C3D4E5F6"
            required
          />
        </label>

        <label className="field">
          <span>Claim code</span>
          <input value={claimCode} onChange={(e) => setClaimCode(e.target.value)} placeholder="ABC123" required />
        </label>

        <button type="submit" className="button button--primary button--block" disabled={loading}>
          {loading ? 'Claiming…' : 'Claim device'}
        </button>
      </form>
    </Modal>
  );
}

export default ClaimDeviceModal;
