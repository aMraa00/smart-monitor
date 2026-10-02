import { Link, useNavigate } from 'react-router-dom';
import AuthForm from '../features/auth/AuthForm';
import { useAuth } from '../hooks/useAuth';

export function RegisterPage() {
  const { register, loading } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(payload) {
    await register(payload);
    navigate('/', { replace: true });
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span aria-hidden="true">◈</span>
          <h1>Smart Monitor</h1>
          <p>Claim your first station in under a minute</p>
        </div>

        <h2 className="auth-card__title">Create account</h2>
        <AuthForm mode="register" onSubmit={handleSubmit} loading={loading} />

        <p className="auth-card__switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default RegisterPage;
