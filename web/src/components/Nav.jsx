import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Nav() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const isStaff = user && (user.role === 'admin' || user.role === 'staff');
  const isReseller = user && user.role === 'reseller';

  return (
    <>
      <div className="topbar">
        <strong>5% OFF</strong> &nbsp;·&nbsp; livraison instantanée &amp; support Discord 24/7
      </div>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand" onClick={() => setOpen(false)}>
            <img src="/logo.png" alt="Anokles" className="brand-logo" />
            Anok<span>les</span>
          </Link>
          <button className="mobile-nav-toggle" type="button" onClick={() => setOpen((v) => !v)}>
            Menu
          </button>
          <nav className={`nav-links ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
            <a href="/#products">Products</a>
            <Link to="/status">Status</Link>
            <a href="/#reviews">Reviews</a>
            <a href="/#faq">FAQ</a>
            <Link to="/downloads">Downloads</Link>
            {user ? <Link to="/dashboard">Dashboard</Link> : null}
            {isReseller ? <Link to="/reseller">Reseller</Link> : null}
            {isStaff ? <Link to="/admin">Admin</Link> : null}
            {user ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={logout}>
                Logout · {user.username}
              </button>
            ) : (
              <NavLink className="btn btn-primary btn-sm" to="/login">
                Sign in
              </NavLink>
            )}
          </nav>
        </div>
      </header>
    </>
  );
}
