import { useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shared register/login form.
 *
 * Client-side validation only mirrors the obvious rules (so the user is not
 * told "invalid email" by the server after a round trip); the backend remains
 * the authority - nothing here is trusted for authorization.
 */
export function AuthForm({ mode, onSubmit, loading }) {
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');

    try {
      await onSubmit(isRegister ? { email: email.trim(), password, name: name.trim() } : { email: email.trim(), password });
    } catch (err) {
      // Server messages are operational (no stack/secret), safe to display.
      setError(err.message || 'Something went wrong.');
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {isRegister && (
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
            autoComplete="name"
            maxLength={80}
          />
        </label>
      )}

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
        />
      </label>

      <button type="submit" className="button button--primary button--block" disabled={loading}>
        {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}

export default AuthForm;
