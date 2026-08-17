import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', email: '', discord_id: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await register(form);
      nav('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page container">
      <div className="auth-box">
        <h1>REGISTER</h1>
        <p className="sub">Crée un compte pour redeem tes clés JinxWare.</p>
        {error ? <div className="alert">{error}</div> : null}
        <form className="form" onSubmit={onSubmit}>
          <label>
            Username
            <input value={form.username} onChange={(e) => set('username', e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required />
          </label>
          <label>
            Email (optionnel)
            <input value={form.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label>
            Discord ID (optionnel)
            <input value={form.discord_id} onChange={(e) => set('discord_id', e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? '...' : 'Create account'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Déjà inscrit ? <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
