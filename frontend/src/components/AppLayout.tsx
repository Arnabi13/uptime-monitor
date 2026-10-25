import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--um-teal)" />
      <path
        d="M5 17h6l3-7 4 13 3-6h6"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="um-app">
      <a href="#main" className="um-skip">
        Skip to content
      </a>
      <header className="um-topbar">
        <div className="um-topbar__inner">
          <Link to="/" className="um-brand">
            <Logo />
            <span>Uptime Monitor</span>
          </Link>
          <nav className="um-nav" aria-label="Main">
            <NavLink to="/" end>
              Monitors
            </NavLink>
            <NavLink to="/status-page">Status page</NavLink>
          </nav>
          <div className="um-account">
            <span className="um-account__email" title={user?.email}>
              {user?.email}
            </span>
            <button type="button" className="um-btn um-btn--quiet" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="um-main">
        <Outlet />
      </main>
    </div>
  );
}
