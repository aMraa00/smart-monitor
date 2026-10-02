import { useState } from 'react';

/**
 * Move a station to another account.
 *
 * The server resolves the target by email and refuses unknown or already-owned
 * targets; this form only carries the address and renders that refusal.
 */
export function TransferForm({ onTransfer, loading }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await onTransfer(email.trim());
      setEmail('');
    } catch (err) {
      setError(err.message || 'Transfer failed');
    }
  }

  return (
    <form className="form form--inline" onSubmit={submit}>
      <label className="field field--grow">
        <span>New owner email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" required />
      </label>
      <button type="submit" className="button button--ghost" disabled={loading}>
        Transfer
      </button>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export default TransferForm;
