import { Link, useNavigate } from 'react-router-dom';
import AuthForm from '../features/auth/AuthForm';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit({ email, password }) {
    await login(email, password);
    navigate('/', { replace: true });
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span aria-hidden="true">◈</span>
          <h1>Smart Monitor</h1>
          <p>Environmental monitoring stations</p>
        </div>

        <h2 className="auth-card__title">Sign in</h2>
        <AuthForm mode="login" onSubmit={handleSubmit} loading={loading} />

        <p className="auth-card__switch">
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
