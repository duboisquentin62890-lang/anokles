import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await login(username, password);
      const staff = ['owner', 'admin', 'staff'].includes(data.user.role) || data.user.is_owner;
      nav(staff ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page container">
      <div className="auth-box">
        <h1>SIGN IN</h1>
        <p className="sub">Accède au dashboard, redeem keys & downloads.</p>
        {error ? <div className="alert">{error}</div> : null}
        <form className="form" onSubmit={onSubmit}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? '...' : 'Login'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Pas de compte ? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
