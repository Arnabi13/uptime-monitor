import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/AppLayout';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Where the user was heading before being sent to log in.
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  const isLogin = mode === 'login';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes('@')) return setError('Enter your email address.');
    if (!isLogin && password.length < 8) return setError('Use at least 8 characters for your password.');
    setSubmitting(true);
    try {
      await (isLogin ? login : register)(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="um-auth">
      <div className="um-auth__panel">
        <Link to="/" className="um-brand">
          <Logo />
          <span>Uptime Monitor</span>
        </Link>
        <h1>{isLogin ? 'Log in' : 'Create your account'}</h1>
        <p className="um-muted">
          {isLogin
            ? 'Check on your sites and incidents.'
            : 'Watch up to 10 sites. Get an email when one goes down.'}
        </p>

        <form onSubmit={onSubmit} className="um-form" noValidate>
          <label className="um-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="um-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={isLogin ? undefined : 8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!isLogin && <small>At least 8 characters.</small>}
          </label>

          {error && (
            <p className="um-alert" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="um-btn um-btn--primary um-btn--block" disabled={submitting}>
            {submitting ? (isLogin ? 'Logging in…' : 'Creating account…') : isLogin ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="um-auth__switch">
          {isLogin ? (
            <>
              New here? <Link to="/register">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
