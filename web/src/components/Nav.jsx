import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const I = {
  products: 'M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4',
  status: 'M3 12h4l3 8 4-16 3 8h4',
  reviews: 'M12 3l2.9 5.9 6.1.9-4.4 4.3 1 6.1L12 17.8 6.4 20.2l1-6.1L3 9.8l6.1-.9L12 3z',
  faq: 'M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4M12 17h.01M12 3a9 9 0 100 18 9 9 0 000-18z',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  shield: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
};
function Ico({ d }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

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
            <img src="/logo.png" alt="JinxWare" className="brand-logo" />
            Jinx<span>ware</span>
          </Link>
          <button className="mobile-nav-toggle" type="button" onClick={() => setOpen((v) => !v)}>
            Menu
          </button>
          <nav className={`nav-links ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
            <a href="/#products"><Ico d={I.products} />Products</a>
            <Link to="/status"><Ico d={I.status} />Status</Link>
            <a href="/#reviews"><Ico d={I.reviews} />Reviews</a>
            <a href="/#faq"><Ico d={I.faq} />FAQ</a>
            <Link to="/downloads"><Ico d={I.download} />Downloads</Link>
            {user ? <Link to="/dashboard"><Ico d={I.dashboard} />Dashboard</Link> : null}
            {isReseller ? <Link to="/reseller"><Ico d={I.shield} />Reseller</Link> : null}
            {isStaff ? <Link to="/admin"><Ico d={I.shield} />Admin</Link> : null}
            {user ? (
              <button className="btn btn-ghost btn-sm btn-round" type="button" onClick={logout}>
                Logout · {user.username}
              </button>
            ) : (
              <NavLink className="btn btn-primary btn-sm btn-round" to="/login">
                <Ico d={I.user} /> Sign in
              </NavLink>
            )}
          </nav>
        </div>
      </header>
    </>
  );
}
